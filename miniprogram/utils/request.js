/**
 * 传输层：只负责把请求送到后端并把结果/失败交回上层。
 *
 * 这里刻意不做三件事（原来 255 行的版本混在一起，是主要技术债）：
 * 1. 不拆信封 —— 交给 utils/envelope.js；
 * 2. 不判断业务语义 —— 交给 utils/failure.js；
 * 3. 不生成幂等键 —— 由 services/submission 按"一次用户意图一个键"生成后传入。
 *
 * 请求路由（与 config/cloud.js 的注释对应）：
 * - serviceName 有值 → wx.cloud.callContainer（生产）
 * - serviceName 为空 + localBaseUrl 有值 → wx.request（本地联调）
 * - 都为空 → 直接报配置错误，不静默发往未知地址
 */
const cloudConfig = require('../config/cloud');
const timing = require('../config/timing');
const { normalizeEnvelope, isSuccessEnvelope } = require('./envelope');
const { ApiError, classify, ERROR_CATEGORY, extractFields } = require('./failure');

function resolveTransport() {
  const serviceName = typeof cloudConfig.serviceName === 'string' ? cloudConfig.serviceName.trim() : '';
  const localBaseUrl = typeof cloudConfig.localBaseUrl === 'string' ? cloudConfig.localBaseUrl.trim() : '';
  if (localBaseUrl && !/^https?:\/\//i.test(localBaseUrl)) {
    throw new ApiError({
      message: '本地服务地址必须以 http:// 或 https:// 开头，请检查 config/cloud.js',
      category: ERROR_CATEGORY.CONFIGURATION,
    });
  }
  if (serviceName) return { mode: 'cloud', serviceName, localBaseUrl: '' };
  if (localBaseUrl) return { mode: 'local', serviceName: '', localBaseUrl: localBaseUrl.replace(/\/+$/, '') };
  throw new ApiError({
    message: '未配置后端服务：请在 config/cloud.js 填写 serviceName（云托管）或 localBaseUrl（本地联调）',
    category: ERROR_CATEGORY.CONFIGURATION,
  });
}

function normalizePath(path) {
  if (typeof path !== 'string' || !path.trim()) {
    throw new ApiError({ message: '请求 path 必须是非空字符串', category: ERROR_CATEGORY.CONFIGURATION });
  }
  const value = path.trim();
  return value.startsWith('/') ? value : `/${value}`;
}

/** 删除顶层 undefined，避免被序列化成字符串 "undefined"；null / '' / 0 / false 保留。 */
function normalizeRequestData(data) {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return data;
  const prototype = Object.getPrototypeOf(data);
  if (prototype !== Object.prototype && prototype !== null) return data;
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

function timeoutError(maybeDelivered) {
  return new ApiError({
    message: '请求超时，请稍后确认结果',
    category: ERROR_CATEGORY.RETRYABLE,
    retryable: true,
    // 写请求超时可能已被服务端处理，标记后由 submission 决定"查结果"而不是"重发"
    maybeDelivered,
  });
}

function withTimeout(promise, timeoutMs, maybeDelivered) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError(maybeDelivered)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * 匿名会话令牌（只存内存，不落 storage）。
 *
 * 公开接口用它在"未登录"状态下把多次请求串成同一个访问者：
 * 服务端首次请求签发 X-Anonymous-Session，后续请求必须回传，否则
 * navigation-check 与 navigation-launches 会被当成两个不同访问者而断链。
 * 它不含任何个人信息，丢失只意味着下次重新签发。
 */
const ANONYMOUS_HEADER = 'X-Anonymous-Session';
let anonymousSessionToken = '';

function readHeader(header, name) {
  if (!header || typeof header !== 'object') return '';
  const target = name.toLowerCase();
  const key = Object.keys(header).find((item) => item.toLowerCase() === target);
  return key ? String(header[key] || '') : '';
}

function withAnonymousSession(header) {
  if (!anonymousSessionToken) return header;
  return { ...header, [ANONYMOUS_HEADER]: anonymousSessionToken };
}

function captureAnonymousSession(response) {
  const issued = readHeader(response && response.header, ANONYMOUS_HEADER);
  if (issued) anonymousSessionToken = issued;
}

function send(transport, { path, method, data, header }) {
  const requestHeader = withAnonymousSession({
    'content-type': 'application/json',
    ...header,
  });
  if (transport.mode === 'local') {
    const devOpenid = typeof cloudConfig.localDevOpenid === 'string' ? cloudConfig.localDevOpenid.trim() : '';
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${transport.localBaseUrl}${path}`,
        method,
        data,
        header: devOpenid ? { ...requestHeader, 'X-Dev-Openid': devOpenid } : requestHeader,
        success: resolve,
        fail: reject,
      });
    });
  }
  if (!wx.cloud || typeof wx.cloud.callContainer !== 'function') {
    return Promise.reject(new ApiError({
      message: '当前微信基础库不支持云托管调用，请升级微信版本',
      category: ERROR_CATEGORY.CONFIGURATION,
    }));
  }
  return wx.cloud.callContainer({
    config: { env: cloudConfig.envId },
    path,
    method,
    data,
    header: {
      ...requestHeader,
      // 目标服务名只以集中配置为准，调用方不能通过 header 切换
      'X-WX-SERVICE': transport.serviceName,
    },
  });
}

/**
 * @param {object} options
 * @param {string} options.path      接口路径（取自 config/endpoints.js）
 * @param {string} [options.method]  HTTP 方法
 * @param {object} [options.data]
 * @param {object} [options.header]
 * @param {string} [options.idempotencyKey] 写命令必传，由 services/submission 生成
 * @returns {Promise<{ data: *, requestId?: string }>} 已剥信封的业务数据
 */
async function request({ path, method = 'GET', data, header = {}, idempotencyKey }) {
  const normalizedPath = normalizePath(path);
  const requestMethod = String(method).toUpperCase();
  const transport = resolveTransport();
  const isWrite = requestMethod !== 'GET';
  const requestHeader = idempotencyKey
    ? { ...header, 'Idempotency-Key': idempotencyKey }
    : header;

  try {
    const response = await withTimeout(
      send(transport, { path: normalizedPath, method: requestMethod, data: normalizeRequestData(data), header: requestHeader }),
      timing.REQUEST_TIMEOUT_MS,
      isWrite,
    );

    const statusCode = response.statusCode || 0;
    // 公开接口会在响应头下发匿名会话，必须先记住再判断成败：
    // 失败响应同样可能携带新令牌，丢掉它会让下一次请求又变成新访问者
    captureAnonymousSession(response);
    const envelope = normalizeEnvelope(response.data, statusCode);

    if (!isSuccessEnvelope(envelope)) {
      const { category, retryable } = classify({ statusCode, bizCode: envelope.bizCode });
      throw new ApiError({
        message: envelope.msg,
        category,
        retryable,
        statusCode,
        bizCode: envelope.bizCode,
        data: envelope.data,
        requestId: envelope.requestId,
        fields: extractFields(envelope.data),
      });
    }

    return { data: envelope.data, requestId: envelope.requestId };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // 网络层异常（域名未配置、断网、TLS 失败等）统一归为可重试，并保留原始 errMsg 供排障
    throw new ApiError({
      message: (error && (error.errMsg || error.message)) || '网络请求失败',
      category: ERROR_CATEGORY.RETRYABLE,
      retryable: true,
      maybeDelivered: isWrite,
      originalError: error,
    });
  }
}

function get(path, data, options = {}) {
  return request({ ...options, path, data, method: 'GET' });
}

function post(path, data, options = {}) {
  return request({ ...options, path, data, method: 'POST' });
}

function put(path, data, options = {}) {
  return request({ ...options, path, data, method: 'PUT' });
}

function remove(path, data, options = {}) {
  return request({ ...options, path, data, method: 'DELETE' });
}

module.exports = { request, get, post, put, remove };

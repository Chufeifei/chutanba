const cloudConfig = require('../config/cloud');
const { ERROR_CODES, RESULT_CODES } = require('../api/contracts');

function classifyFailure(statusCode, bizCode, transportCode) {
  if (statusCode === 401 || ['UNAUTHORIZED', 'AUTHENTICATION_EXPIRED'].includes(bizCode)) {
    return { clientCode: ERROR_CODES.AUTHENTICATION_EXPIRED, resultCode: RESULT_CODES.AUTHENTICATION_REQUIRED, retryable: false };
  }
  if (statusCode === 403 || ['FORBIDDEN', 'PERMISSION_DENIED'].includes(bizCode)) {
    return { clientCode: ERROR_CODES.PERMISSION_DENIED, resultCode: RESULT_CODES.PERMISSION_REQUIRED, retryable: false };
  }
  if (statusCode === 409) {
    return { clientCode: ERROR_CODES.STATE_CONFLICT, resultCode: RESULT_CODES.REFRESH_REQUIRED, retryable: false };
  }
  const retryable = statusCode === 0 || statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500;
  return {
    clientCode: retryable ? ERROR_CODES.RETRYABLE_FAILURE : (bizCode || transportCode || ERROR_CODES.VALIDATION_FAILED),
    resultCode: retryable ? RESULT_CODES.RETRY_AVAILABLE : RESULT_CODES.TERMINAL,
    retryable,
  };
}

function normalizeEnvelope(body, statusCode = 200) {
  if (body && typeof body === 'object' && !Array.isArray(body) && ('code' in body || 'data' in body || 'msg' in body)) {
    const envelope = {
      ...body,
      code: body.code == null ? statusCode : body.code,
      msg: body.msg || body.message || (statusCode >= 200 && statusCode < 300 ? 'ok' : '请求处理失败'),
    };
    if ('data' in body) envelope.data = body.data;
    return envelope;
  }
  return { code: statusCode, msg: statusCode >= 200 && statusCode < 300 ? 'ok' : '请求处理失败', data: body };
}

/**
 * 统一请求异常。
 * 页面层可以根据 code 判断错误类型，也可以直接展示 message。
 */
class RequestError extends Error {
  constructor({ message, code = 'REQUEST_FAILED', statusCode = 0, data = null, originalError = null, bizCode = undefined,
    clientCode, resultCode, retryable }) {
    super(message);
    this.name = 'RequestError';
    this.code = code;
    this.statusCode = statusCode;
    this.data = data;
    this.originalError = originalError;
    this.bizCode = bizCode;
    const classification = classifyFailure(statusCode, bizCode, code);
    this.clientCode = clientCode || classification.clientCode;
    this.resultCode = resultCode || classification.resultCode;
    this.retryable = retryable == null ? classification.retryable : Boolean(retryable);
    this.authenticationExpired = this.clientCode === ERROR_CODES.AUTHENTICATION_EXPIRED;
    this.permissionDenied = this.clientCode === ERROR_CODES.PERMISSION_DENIED;
    this.conflict = this.clientCode === ERROR_CODES.STATE_CONFLICT;
  }
}

/** 发起请求前校验集中配置，避免错误请求发送到未知环境或服务。 */
function validateCloudConfig() {
  const missingFields = [];

  if (!cloudConfig.envId) {
    missingFields.push('envId');
  }

  if (!cloudConfig.serviceName) {
    missingFields.push('serviceName');
  }

  if (missingFields.length > 0) {
    throw new RequestError({
      code: 'CLOUD_CONFIG_MISSING',
      message: `云托管配置缺失：${missingFields.join(', ')}，请检查 miniprogram/config/cloud.js`,
    });
  }
}

/** 返回已清理的本地服务地址；未配置时返回空字符串。 */
function getLocalBaseUrl() {
  if (typeof cloudConfig.localBaseUrl !== 'string') {
    return '';
  }

  const baseUrl = cloudConfig.localBaseUrl.trim().replace(/\/+$/, '');
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    throw new RequestError({
      code: 'LOCAL_BASE_URL_INVALID',
      message: '本地服务地址必须以 http:// 或 https:// 开头，请检查 miniprogram/config/cloud.js',
    });
  }

  return baseUrl;
}

/** 本地联调身份只允许随 wx.request 发送，云托管请求不使用客户端伪造身份。 */
function getLocalDevOpenid() {
  return typeof cloudConfig.localDevOpenid === 'string' ? cloudConfig.localDevOpenid.trim() : '';
}

/** 保证接口路径始终以 / 开头，减少各 API 模块重复处理。 */
function normalizePath(path) {
  if (typeof path !== 'string' || path.trim() === '') {
    throw new RequestError({
      code: 'INVALID_REQUEST_PATH',
      message: '请求 path 必须是非空字符串',
    });
  }

  const normalized = path.trim();
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

/**
 * 删除普通对象顶层的 undefined 属性，避免 GET 参数被序列化为字符串 "undefined"。
 * null、空字符串、0 和 false 可能是有意义的 API 输入，必须保留。
 */
function normalizeRequestData(data) {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return data;
  const prototype = Object.getPrototypeOf(data);
  if (prototype !== Object.prototype && prototype !== null) return data;
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

/**
 * 统一调用后端服务：serviceName 有值时强制使用云托管；否则配置 localBaseUrl 时使用 wx.request。
 *
 * @param {object} options 请求参数
 * @param {string} options.path Express 接口路径
 * @param {string} [options.method='GET'] HTTP 方法
 * @param {object} [options.data] 请求数据
 * @param {object} [options.header] 额外请求头
 * @returns {Promise<*>} 直接返回后端 JSON 响应体
 */
async function request({ path, method = 'GET', data, header = {}, idempotencyKey }) {
  const normalizedPath = normalizePath(path);
  const normalizedData = normalizeRequestData(data);
  const hasCloudService = typeof cloudConfig.serviceName === 'string' && cloudConfig.serviceName.trim() !== '';
  const localBaseUrl = hasCloudService ? '' : getLocalBaseUrl();

  if (!localBaseUrl) {
    validateCloudConfig();
  }

  try {
    const requestMethod = method.toUpperCase();
    const requestHeader = {
      'content-type': 'application/json',
      ...header,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey, 'X-Request-Id': idempotencyKey } : {}),
    };
    let response;

    if (localBaseUrl) {
      const localDevOpenid = getLocalDevOpenid();
      response = await new Promise((resolve, reject) => {
        wx.request({
          url: `${localBaseUrl}${normalizedPath}`,
          method: requestMethod,
          header: {
            ...requestHeader,
            ...(localDevOpenid ? { 'X-Dev-Openid': localDevOpenid } : {}),
          },
          data: normalizedData,
          success: resolve,
          fail: reject,
        });
      });
    } else {
      response = await wx.cloud.callContainer({
        config: {
          env: cloudConfig.envId,
        },
        path: normalizedPath,
        method: requestMethod,
        header: {
          ...requestHeader,
          // 服务名称始终以集中配置为准，调用方不能通过自定义 Header 切换目标服务。
          'X-WX-SERVICE': cloudConfig.serviceName,
        },
        data: normalizedData,
      });
    }

    const responseData = normalizeEnvelope(response.data, response.statusCode || 0);
    const statusCode = response.statusCode || 0;

    // HTTP 非 2xx 统一转为 RequestError，页面不会收到微信 SDK 的原始响应结构。
    if (statusCode < 200 || statusCode >= 300) {
      throw new RequestError({
        code: responseData && responseData.code ? responseData.code : `HTTP_${statusCode}`,
        message: responseData && responseData.msg ? responseData.msg : `请求失败（HTTP ${statusCode}）`,
        bizCode: responseData && responseData.bizCode ? responseData.bizCode : undefined,
        statusCode,
        data: responseData,
      });
    }

    // 当前后端约定 code 为 HTTP 风格状态码；2xx 表示成功，4xx/5xx 表示业务或服务异常。
    if (
      responseData
      && typeof responseData.code === 'number'
      && (responseData.code < 200 || responseData.code >= 300)
    ) {
      throw new RequestError({
        code: responseData.code,
        message: responseData.msg || '请求处理失败',
        bizCode: responseData.bizCode ? responseData.bizCode : undefined,
        statusCode,
        data: responseData,
      });
    }

    return responseData;
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }

    // 隐藏 wx.request / wx.cloud.callContainer 的 SDK 错误差异。
    throw new RequestError({
      code: localBaseUrl ? 'LOCAL_REQUEST_FAILED' : 'CLOUD_CONTAINER_REQUEST_FAILED',
      message: error.errMsg || error.message || (localBaseUrl ? '本地服务请求失败' : '云托管服务请求失败'),
      originalError: error,
    });
  }
}

/** 以下快捷方法让 API 模块只关注路径和数据。 */
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

module.exports = {
  RequestError,
  classifyFailure,
  normalizeEnvelope,
  request,
  get,
  post,
  put,
  remove,
};

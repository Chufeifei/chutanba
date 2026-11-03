/**
 * 请求失败分类（依据 doc/MVP/一期数据模型与接口约定.md §6）。
 *
 * 分类只回答"这是什么性质的失败、能不能直接重试"，不负责展示文案 ——
 * 文案由页面按状态渲染，避免每个调用点自己拼提示。
 *
 * 最重要的一条：NETWORK 错误不等于"操作没发生"。
 * 写请求超时说明我们不知道服务端是否已经成立，必须按原操作键查询（见 services/submission）。
 */
const { VIEW_STATE, createViewState } = require('./view-state');
const { BIZ_CODE } = require('../config/contracts');

const ERROR_CATEGORY = Object.freeze({
  AUTHENTICATION: 'authentication',
  PERMISSION: 'permission',
  NOT_ELIGIBLE: 'not-eligible',
  NOT_FOUND: 'not-found',
  CONFLICT: 'conflict',
  WINDOW_CLOSED: 'window-closed',
  VALIDATION: 'validation',
  BUSINESS_RULE: 'business-rule',
  RETRYABLE: 'retryable',
  CONFIGURATION: 'configuration',
});

class ApiError extends Error {
  constructor({
    message = '请求处理失败',
    category = ERROR_CATEGORY.RETRYABLE,
    statusCode = 0,
    bizCode,
    data = null,
    requestId,
    retryable = false,
    maybeDelivered = false,
    fields = [],
    originalError = null,
  } = {}) {
    super(message);
    this.name = 'ApiError';
    this.category = category;
    this.statusCode = statusCode;
    this.bizCode = bizCode;
    this.data = data;
    this.requestId = requestId;
    this.retryable = retryable;
    // 请求可能已被服务端处理但响应丢失：写命令据此进入"结果未知"，不能当失败重发
    this.maybeDelivered = maybeDelivered;
    this.fields = fields;
    this.originalError = originalError;
  }

  get isAuthentication() { return this.category === ERROR_CATEGORY.AUTHENTICATION; }
  get isPermission() { return this.category === ERROR_CATEGORY.PERMISSION; }
  get isConflict() { return this.category === ERROR_CATEGORY.CONFLICT; }
  get isNetwork() { return this.category === ERROR_CATEGORY.RETRYABLE; }
}

const BIZ_CATEGORY = Object.freeze({
  [BIZ_CODE.VALIDATION_FAILED]: ERROR_CATEGORY.VALIDATION,
  [BIZ_CODE.AUTH_REQUIRED]: ERROR_CATEGORY.AUTHENTICATION,
  [BIZ_CODE.PERMISSION_DENIED]: ERROR_CATEGORY.PERMISSION,
  [BIZ_CODE.NOT_ELIGIBLE]: ERROR_CATEGORY.NOT_ELIGIBLE,
  [BIZ_CODE.RESOURCE_NOT_FOUND]: ERROR_CATEGORY.NOT_FOUND,
  [BIZ_CODE.STATE_CONFLICT]: ERROR_CATEGORY.CONFLICT,
  [BIZ_CODE.IDEMPOTENCY_MISMATCH]: ERROR_CATEGORY.CONFLICT,
  [BIZ_CODE.ALREADY_PROCESSED]: ERROR_CATEGORY.CONFLICT,
  [BIZ_CODE.WINDOW_CLOSED]: ERROR_CATEGORY.WINDOW_CLOSED,
  [BIZ_CODE.CONTEXT_EXPIRED]: ERROR_CATEGORY.WINDOW_CLOSED,
  [BIZ_CODE.TIME_INVALID]: ERROR_CATEGORY.BUSINESS_RULE,
  [BIZ_CODE.LOCATION_INVALID]: ERROR_CATEGORY.BUSINESS_RULE,
  [BIZ_CODE.LOCATION_TOO_FAR]: ERROR_CATEGORY.BUSINESS_RULE,
  [BIZ_CODE.PROFILE_REQUIRED]: ERROR_CATEGORY.BUSINESS_RULE,
  [BIZ_CODE.NOT_NAVIGABLE]: ERROR_CATEGORY.BUSINESS_RULE,
  [BIZ_CODE.SERVICE_UNAVAILABLE]: ERROR_CATEGORY.RETRYABLE,
});

function classify({ statusCode = 0, bizCode } = {}) {
  if (bizCode && BIZ_CATEGORY[bizCode]) {
    const category = BIZ_CATEGORY[bizCode];
    return { category, retryable: category === ERROR_CATEGORY.RETRYABLE };
  }
  if (statusCode === 401) return { category: ERROR_CATEGORY.AUTHENTICATION, retryable: false };
  if (statusCode === 403) return { category: ERROR_CATEGORY.PERMISSION, retryable: false };
  if (statusCode === 404) return { category: ERROR_CATEGORY.NOT_FOUND, retryable: false };
  if (statusCode === 409) return { category: ERROR_CATEGORY.CONFLICT, retryable: false };
  if (statusCode === 410) return { category: ERROR_CATEGORY.WINDOW_CLOSED, retryable: false };
  if (statusCode === 422) return { category: ERROR_CATEGORY.BUSINESS_RULE, retryable: false };
  if (statusCode === 400) return { category: ERROR_CATEGORY.VALIDATION, retryable: false };
  // 408/5xx/无状态码（网络层失败）都归为可重试
  return { category: ERROR_CATEGORY.RETRYABLE, retryable: true };
}

/** 从错误体的 data.fields 提取字段级错误，供表单定位到原输入项。 */
function extractFields(data) {
  if (!data || !Array.isArray(data.fields)) return [];
  return data.fields
    .filter((item) => item && typeof item.field === 'string')
    .map((item) => ({ field: item.field, reason: item.reason || 'INVALID' }));
}

/** 读失败的整页状态映射。写失败不要用这个，用 toWriteOutcome。 */
function toViewState(error, overrides = {}) {
  const message = error && error.message ? error.message : '请返回查看最新状态';
  switch (error && error.category) {
    case ERROR_CATEGORY.AUTHENTICATION:
      return createViewState(VIEW_STATE.PERMISSION, {
        title: '登录状态已失效',
        description: message,
        actionText: '重新登录',
        ...overrides,
      });
    case ERROR_CATEGORY.PERMISSION:
      return createViewState(VIEW_STATE.PERMISSION, { description: message, ...overrides });
    case ERROR_CATEGORY.NOT_ELIGIBLE:
      return createViewState(VIEW_STATE.TERMINAL_ERROR, {
        title: '当前不具备操作资格',
        description: message,
        ...overrides,
      });
    case ERROR_CATEGORY.CONFLICT:
      return createViewState(VIEW_STATE.CONFLICT, { description: message, ...overrides });
    case ERROR_CATEGORY.WINDOW_CLOSED:
      return createViewState(VIEW_STATE.TERMINAL_ERROR, {
        title: '操作窗口已关闭',
        description: message,
        ...overrides,
      });
    case ERROR_CATEGORY.RETRYABLE:
      return createViewState(VIEW_STATE.RETRYABLE_ERROR, { description: message, ...overrides });
    default:
      return createViewState(VIEW_STATE.TERMINAL_ERROR, { description: message, ...overrides });
  }
}

const WRITE_OUTCOME = Object.freeze({
  SUCCEEDED: 'succeeded',
  PENDING: 'pending',
  UNKNOWN: 'unknown',
  CONFLICT: 'conflict',
  INVALID: 'invalid',
  FAILED: 'failed',
});

/**
 * 写命令的失败归并。
 *
 * - UNKNOWN：请求可能已到达服务端，必须按原操作键查询，绝不换键重发；
 * - INVALID：字段错误，保留用户输入并定位到原项；
 * - CONFLICT：版本或状态已变，先读最新结果再让用户重新决定；
 * - FAILED：确定未成立，可以安全地由用户再次发起。
 */
function toWriteOutcome(error) {
  const message = error && error.message ? error.message : '操作未能完成';
  // bizCode 必须一路带到页面：ALREADY_PROCESSED 与一般冲突的处理方式完全不同，
  // 靠 msg 文本判断会在文案微调后失效
  const bizCode = error && error.bizCode ? error.bizCode : undefined;
  if (!error) return { outcome: WRITE_OUTCOME.FAILED, message };
  if (error.maybeDelivered || (error.category === ERROR_CATEGORY.RETRYABLE && error.statusCode === 0)) {
    return { outcome: WRITE_OUTCOME.UNKNOWN, message, retryable: true, bizCode };
  }
  switch (error.category) {
    case ERROR_CATEGORY.VALIDATION:
      return { outcome: WRITE_OUTCOME.INVALID, message, fields: error.fields || [], bizCode };
    case ERROR_CATEGORY.CONFLICT:
      return { outcome: WRITE_OUTCOME.CONFLICT, message, bizCode };
    case ERROR_CATEGORY.AUTHENTICATION:
    case ERROR_CATEGORY.PERMISSION:
    case ERROR_CATEGORY.NOT_ELIGIBLE:
    case ERROR_CATEGORY.WINDOW_CLOSED:
      return { outcome: WRITE_OUTCOME.FAILED, message, terminal: true, bizCode };
    case ERROR_CATEGORY.RETRYABLE:
      return { outcome: WRITE_OUTCOME.FAILED, message, retryable: true, bizCode };
    default:
      return { outcome: WRITE_OUTCOME.FAILED, message, bizCode };
  }
}

module.exports = {
  ERROR_CATEGORY,
  WRITE_OUTCOME,
  ApiError,
  classify,
  extractFields,
  toViewState,
  toWriteOutcome,
};

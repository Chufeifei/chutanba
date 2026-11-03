/**
 * 一期接口契约 §6 的错误语义码。
 *
 * httpStatus 与默认展示文案在这里唯一登记：业务层只抛 DomainError，
 * HTTP 状态与响应信封由 middlewares/error-handler.js 统一转换。
 * 新增错误码前先核对 doc/MVP/一期数据模型与接口约定.md，不要自行扩展。
 */
const BIZ_CODES = Object.freeze({
  VALIDATION_FAILED: { httpStatus: 400, message: '请求参数不合法' },
  AUTH_REQUIRED: { httpStatus: 401, message: '需要可识别的账号身份' },
  PERMISSION_DENIED: { httpStatus: 403, message: '无操作权限' },
  NOT_ELIGIBLE: { httpStatus: 403, message: '当前资格不满足该操作' },
  RESOURCE_NOT_FOUND: { httpStatus: 404, message: '资源不存在或无权访问' },
  STATE_CONFLICT: { httpStatus: 409, message: '状态已更新，请刷新后重试' },
  IDEMPOTENCY_MISMATCH: { httpStatus: 409, message: '同一操作键的请求内容不一致' },
  ALREADY_PROCESSED: { httpStatus: 409, message: '该事项已有处理结果' },
  WINDOW_CLOSED: { httpStatus: 410, message: '操作窗口已关闭' },
  CONTEXT_EXPIRED: { httpStatus: 410, message: '上下文令牌已过期' },
  TIME_INVALID: { httpStatus: 422, message: '时间不在允许范围' },
  LOCATION_INVALID: { httpStatus: 422, message: '定位结果不可用' },
  LOCATION_TOO_FAR: { httpStatus: 422, message: '定位距离超出受理范围' },
  PROFILE_REQUIRED: { httpStatus: 422, message: '缺少可公开的生效资料' },
  NOT_NAVIGABLE: { httpStatus: 422, message: '当前不可导航' },
  SERVICE_UNAVAILABLE: { httpStatus: 503, message: '权威状态暂时无法确认' },
  // 公开集合超过可返回上限时明确失败，不截断、不返回部分集合。
  SNAPSHOT_TOO_LARGE: { httpStatus: 503, message: '当前公开集合规模超出可返回范围' },
  // 非一期契约码，仅用于未预期异常兜底，业务层不得主动使用。
  INTERNAL_ERROR: { httpStatus: 500, message: '服务器内部错误' },
});

class DomainError extends Error {
  /**
   * @param {string} bizCode BIZ_CODES 中的语义码
   * @param {string} [message] 面向用户的说明；缺省使用语义码默认文案
   * @param {object|null} [data] 最小纠错信息（如字段错误），不得包含敏感值
   */
  constructor(bizCode, message, data = null) {
    const definition = BIZ_CODES[bizCode];
    if (!definition) {
      throw new TypeError(`未登记的 bizCode：${bizCode}`);
    }

    super(message || definition.message);
    this.name = 'DomainError';
    this.bizCode = bizCode;
    this.httpStatus = definition.httpStatus;
    this.data = data;
  }
}

module.exports = { BIZ_CODES, DomainError };

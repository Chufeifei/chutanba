/**
 * 通用领域错误与错误工厂（架构层）。
 * 业务错误码以字面量字符串给出，避免与已移除的业务契约模块产生依赖；
 * 后续业务模块可在此处扩展自有语义码。
 */
class DomainError extends Error {
  constructor(code, message, httpStatus = 400, details) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

const errors = {
  validation: (message, details) => new DomainError('VALIDATION_FAILED', message, 422, details),
  unauthorized: (message = '未授权') => new DomainError('AUTHENTICATION_EXPIRED', message, 401),
  forbidden: (message = '无权执行该操作') => new DomainError('PERMISSION_DENIED', message, 403),
  notFound: (message = '资源不存在') => new DomainError('NOT_FOUND', message, 404),
  conflict: (code, message, details) => new DomainError(code, message, 409, details),
  managementNotConfigured: () => new DomainError('MANAGEMENT_NOT_CONFIGURED', '管理权限未配置', 503),
};

module.exports = { DomainError, errors };

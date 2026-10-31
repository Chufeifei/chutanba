/**
 * 统一 HTTP 响应。后端约定 code 为 HTTP 风格状态码：
 * 2xx 表示成功，4xx/5xx 表示业务或服务异常；msg 为可读信息，data 为业务数据。
 */

function ok(res, data = null, msg = 'ok') {
  return res.status(200).json({ code: 200, msg, data });
}

function fail(res, code, msg, data = null) {
  const numeric = typeof code === 'number' ? code : 0;
  const status = numeric >= 400 && numeric < 600 ? numeric : 200;
  return res.status(status).json({ code, msg, data });
}

/** 业务可预期错误：code 为 HTTP 风格状态码，bizCode 为业务错误码（api-contract 中的语义码），status 为 HTTP 状态码。 */
class AppError extends Error {
  constructor(code, msg, status, bizCode) {
    super(msg);
    this.name = 'AppError';
    this.code = code;
    this.bizCode = bizCode || null;
    this.status = status || (typeof code === 'number' && code >= 400 ? code : 200);
  }
}

module.exports = { ok, fail, AppError };

const env = require('../config/env');

/**
 * Express 统一错误处理中间件。
 * - 业务可预期错误（AppError）按自带状态码与业务码返回。
 * - 其余错误按 500 处理，生产环境不把堆栈返回给客户端。
 */
function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  if (error && error.name === 'DomainError') {
    // 统一信封 {code, bizCode, msg, data}：data 恒为 null，保证小程序端解析路径单一。
    const body = { code: error.httpStatus, bizCode: error.code, msg: error.message, data: null };
    if (error.details && env.nodeEnv !== 'production') body.details = error.details;
    return res.status(error.httpStatus).json(body);
  }

  if (error && error.name === 'AppError') {
    const status = error.status || (error.code >= 400 ? error.code : 200);
    const body = { code: error.code, msg: error.message, data: null };
    if (error.bizCode) {
      body.bizCode = error.bizCode;
    }
    return res.status(status).json(body);
  }

  if (error && error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      code: 409,
      bizCode: 'CONCURRENT_CONFLICT',
      msg: '请求与当前业务状态冲突，请刷新后重试',
      data: null,
    });
  }

  console.error(error);

  const response = { code: 500, msg: '服务器内部错误', data: null };
  if (env.nodeEnv !== 'production') {
    response.detail = error.message;
  }

  return res.status(500).json(response);
}

module.exports = errorHandler;

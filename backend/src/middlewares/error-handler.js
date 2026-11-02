const { success, failure } = require('../utils/response');
const env = require('../config/env');

/**
 * 统一错误收口：业务错误按 DomainError 自带的 bizCode 与 HTTP 状态返回，
 * 其余异常一律 500，且生产环境不把内部细节返回给客户端。
 */
function errorHandler(error, req, res, next) { // eslint-disable-line no-unused-vars
  if (error && error.name === 'DomainError') {
    return failure(res, {
      httpStatus: error.httpStatus,
      bizCode: error.bizCode,
      msg: error.message,
      data: error.data,
    });
  }

  // 请求体解析失败（超限或 JSON 非法）属于客户端入参问题，必须落 400，
  // 否则会被兜底成 500，让客户端误以为是服务故障。
  if (error && (error.type === 'entity.too.large' || error.type === 'entity.parse.failed')) {
    return failure(res, {
      httpStatus: 400,
      bizCode: 'VALIDATION_FAILED',
      msg: '请求体不合法或超出大小上限',
    });
  }

  // 唯一索引冲突通常是并发重复写入；not-found 与错误码语义不同，不能当业务成功处理。
  if (error && error.code === 'ER_DUP_ENTRY') {
    return failure(res, {
      httpStatus: 409,
      bizCode: 'STATE_CONFLICT',
      msg: '请求与当前业务状态冲突，请刷新后重试',
    });
  }

  console.error(error);

  const body = {
    httpStatus: 500,
    bizCode: 'INTERNAL_ERROR',
    msg: '服务器内部错误',
  };

  // 本地排查需要看到原始异常；生产环境连错误信息都不能外泄。
  if (env.nodeEnv !== 'production') {
    body.data = { detail: error && error.message };
  }

  return failure(res, body);
}

module.exports = errorHandler;

const crypto = require('node:crypto');

/**
 * 每个请求生成独立的 requestId，用于排障与日志关联。
 * 不复用客户端的 Idempotency-Key，也不接受客户端传入的 ID：两者用途不同，
 * 幂等键是业务去重凭据，requestId 只是本次请求的追踪标识。
 */
function attachRequestId(req, res, next) {
  const requestId = crypto.randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

module.exports = attachRequestId;

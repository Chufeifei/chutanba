const crypto = require('node:crypto');
const env = require('../config/env');

/** 定长安全比较：先比长度再逐字节比较，避免通过响应时间推测令牌。 */
function safeEqual(provided, expected) {
  const left = Buffer.from(String(provided));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** 支持 X-Job-Token 请求头或 Authorization: Bearer <token> 两种写法。 */
function readJobToken(req) {
  const header = req.headers['x-job-token'];
  if (header) return String(header);
  const authorization = String(req.headers.authorization || '');
  if (authorization.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  return '';
}

/**
 * 调度端点鉴权：
 * - 未配置令牌 → 503，端点不启用（安全默认，防止公网可匿名触发作业）。
 * - 令牌不匹配 → 401。
 * 该端点不接受微信身份，也不读取任何业务身份头。
 */
function requireJobToken(req, res, next) {
  const expected = env.jobs.triggerToken;
  if (!expected) {
    return res.status(503).json({ code: 503, msg: '调度端点未启用：缺少 JOB_TRIGGER_TOKEN 配置' });
  }
  const provided = readJobToken(req);
  if (!provided || !safeEqual(provided, expected)) {
    return res.status(401).json({ code: 401, msg: '调度令牌无效' });
  }
  return next();
}

module.exports = { requireJobToken, readJobToken, safeEqual };

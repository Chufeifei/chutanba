const env = require('../config/env');
const { DomainError } = require('../domain/errors');

/**
 * 可信身份边界（架构手册 §可信身份）：
 * - 生产环境只信任微信云托管在请求头注入的身份（X-WX-OPENID / X-WX-UNIONID / X-WX-USERID）。
 * - 绝不信任请求体或查询参数中的 openid / role / user_id。
 * - X-Dev-Openid 仅在非生产且显式配置 ALLOW_DEV_IDENTITY=true 时可用；
 *   生产环境即使误配该开关也必须忽略，避免模拟头成为绕过身份链的后门。
 *
 * 第二个参数只用于单元测试注入配置；运行时调用方一律使用默认的 env。
 */
function extractTrustedIdentity(req, config = env) {
  const openid = req.headers['x-wx-openid'];
  const unionid = req.headers['x-wx-unionid'];
  const userId = req.headers['x-wx-userid'];

  if (openid || unionid || userId) {
    return {
      openid: openid || null,
      unionid: unionid || null,
      userId: userId ? Number(userId) : null,
      source: 'platform',
    };
  }

  const allowDev = Boolean(config.identity && config.identity.allowDev);
  if (config.nodeEnv !== 'production' && allowDev) {
    const devOpenid = req.headers['x-dev-openid'];
    if (devOpenid) {
      return { openid: devOpenid, unionid: null, userId: null, source: 'dev' };
    }
  }

  return null;
}

/** 始终执行：把可信身份挂到 req.identity（可能为 null）。 */
function attachIdentity(req, res, next) {
  req.identity = extractTrustedIdentity(req);
  next();
}

/** 本人资源与写操作入口：无身份直接按契约返回 401 AUTH_REQUIRED。 */
function requireIdentity(req, res, next) {
  if (!req.identity) {
    return next(new DomainError('AUTH_REQUIRED'));
  }
  return next();
}

module.exports = { attachIdentity, extractTrustedIdentity, requireIdentity };

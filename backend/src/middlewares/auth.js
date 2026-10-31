const env = require('../config/env');

/**
 * 可信身份边界（架构手册 §可信身份）：
 * - 生产环境只信任微信云托管在请求头注入的身份（X-WX-OPENID / X-WX-UNIONID / X-WX-USERID）。
 * - 绝不信任请求体中的 openid / role / user_id。
 * - 非生产环境允许 X-Dev-Openid 用于本地联调，生产必须移除该分支。
 *
 * 注：原 requireUser / requireAdmin 等资源级鉴权函数已随业务逻辑移除；
 * 后续业务模块接入时，应在此可信身份边界之上自行实现授权校验。
 */
function extractTrustedIdentity(req) {
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

  if (env.nodeEnv !== 'production') {
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

module.exports = { attachIdentity, extractTrustedIdentity };

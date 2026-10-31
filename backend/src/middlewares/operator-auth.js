const env = require('../config/env');
const { errors } = require('../domain/errors');

/**
 * 运营身份鉴权（架构手册 §可信身份 之上的资源级授权）。
 *
 * 分层约定：
 * - attachIdentity 负责「你是谁」——只信任平台注入的微信身份头，绝不信任请求体。
 * - 本模块负责「你能不能做运营写操作」——在可信身份之上做授权判定。
 *
 * 失败关闭（fail-closed）原则，三种情况一律拒绝，绝不放行：
 * 1. 没有可信身份 → 403 PERMISSION_DENIED（匿名请求连门都进不去）。
 * 2. 配置了白名单但身份不在其中 → 403 PERMISSION_DENIED。
 * 3. 运营白名单未配置 → 503 MANAGEMENT_NOT_CONFIGURED（能力未开放，而不是裸奔）。
 *
 * 为什么不查「超管表」：本仓库当前不存在管理员角色数据源，凭空的角色表查询
 * 只会引入一个永远返回空集的伪鉴权分支。因此先用可运维配置的白名单落地授权语义，
 * 待角色数据源就绪后仅替换 resolveOperator 判定逻辑，中间件契约与路由不变。
 */

/** 运营身份判定：默认实现基于环境变量白名单。 */
function resolveOperator(identity) {
  const allowlist = env.admin && Array.isArray(env.admin.operatorOpenids) ? env.admin.operatorOpenids : [];
  if (allowlist.length === 0) {
    // 能力未配置：与调度端点同款语义，宁可不可用也不裸奔。
    throw errors.managementNotConfigured();
  }
  if (!identity || !identity.openid) {
    throw errors.forbidden('缺少可信运营身份');
  }
  if (!allowlist.includes(identity.openid)) {
    throw errors.forbidden('该身份不具备运营权限');
  }
  return { openid: identity.openid, source: identity.source };
}

/**
 * 生成运营鉴权中间件。
 * @param {object} deps 依赖注入，便于测试替换身份判定逻辑。
 * @returns {function} Express 中间件
 */
function createRequireOperator({ resolve = resolveOperator } = {}) {
  return function requireOperator(req, res, next) {
    try {
      // attachIdentity 未挂载时 identity 为 undefined，等价于无身份。
      req.operator = resolve(req.identity);
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createRequireOperator, resolveOperator };
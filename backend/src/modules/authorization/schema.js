/**
 * 部署名单 → 期望授权集合的纯函数；不直接读 env，便于测试差异计算。
 * 名单来源只由部署配置决定，客户端参数永远不参与。
 */
const ROLE_NAMES = Object.freeze(['SUPER_ADMIN', 'ADMIN']);
const PERMISSION_NAMES = Object.freeze(['PROFILE_REVIEWER', 'FIELD_REVIEWER']);
const CONFIG_KEYS = Object.freeze({
  SUPER_ADMIN: 'superAdminOpenids',
  ADMIN: 'adminOpenids',
  PROFILE_REVIEWER: 'profileReviewerOpenids',
  FIELD_REVIEWER: 'fieldReviewerOpenids',
});

function isListed(config, key, openid) {
  const list = config ? config[key] : null;
  return Array.isArray(list) && list.includes(openid);
}

function expectedGrants(config, openid) {
  return {
    roles: ROLE_NAMES.filter((roleCode) => isListed(config, CONFIG_KEYS[roleCode], openid)),
    permissions: PERMISSION_NAMES.filter((code) => isListed(config, CONFIG_KEYS[code], openid)),
  };
}

module.exports = { ROLE_NAMES, PERMISSION_NAMES, expectedGrants };

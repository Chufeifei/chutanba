/** capabilities 固定顺序，只返回实际命中的能力码；SUPER_ADMIN 不展开通配。 */
const CAPABILITY_ORDER = Object.freeze(['SUPER_ADMIN', 'ADMIN', 'PROFILE_REVIEWER', 'FIELD_REVIEWER']);

function toCapabilities(roleCodes, permissionCodes) {
  const granted = new Set([...roleCodes, ...permissionCodes]);
  return CAPABILITY_ORDER.filter((code) => granted.has(code));
}

module.exports = { toCapabilities };

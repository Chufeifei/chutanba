/**
 * /me 响应整形。
 *
 * 契约里的 /me 返回的是扁平字段，页面需要的是"能不能显示这个入口、显示什么状态"。
 * 这个转换只做一次，避免 P03 / P09 / P14 各自从原始字段推断。
 *
 * 注意：profileEligible 只用于决定入口与提示文案。
 * 真正的开摊 / 公开资格由服务端在写命令时按权威状态重新判定，
 * 客户端不能因为这里算出 true 就认为一定可以开摊。
 */
const { PROFILE_STATE, PROFILE_STATE_LABEL } = require('../../config/contracts');

/**
 * @param {object} raw GET /me 的 data
 * @returns {object|null} 归一化快照；账号不可识别时返回 null
 */
function toIdentitySnapshot(raw) {
  if (!raw || !raw.accountId) return null;

  const selfStoppedAtMs = raw.selfStoppedAtMs == null ? null : Number(raw.selfStoppedAtMs);
  const governancePausedAtMs = raw.governancePausedAtMs == null ? null : Number(raw.governancePausedAtMs);
  const profileState = raw.profileState || null;
  const hasActiveProfile = Boolean(raw.activeProfileVersionId);

  return {
    accountId: String(raw.accountId),
    accountVersion: Number(raw.accountVersion) || 0,
    vendorId: raw.vendorId == null ? null : String(raw.vendorId),
    profileState,
    activeProfileVersionId: raw.activeProfileVersionId == null ? null : String(raw.activeProfileVersionId),
    selfStoppedAtMs,
    governancePausedAtMs,
    // 两类限制独立成立，任一生效都不具备开摊资格（需求 O-03）
    selfStopped: selfStoppedAtMs != null,
    governancePaused: governancePausedAtMs != null,
    profileEligible: hasActiveProfile && selfStoppedAtMs == null && governancePausedAtMs == null,
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.slice() : [],
    stateVersion: raw.stateVersion == null ? null : Number(raw.stateVersion),
    syncedAtMs: Date.now(),
  };
}

/**
 * 资料状态的中文说明，供 P03／P07 直接用。
 *
 * 注意用的是 PROFILE_STATE（后端 deriveProfileState 的七值派生），
 * 不是 PROFILE_REVIEW_STATUS（单次申请的审核结论）。两者混用会让
 * /me 的 profileState 永远落到兜底分支，页面一直显示「未提交」。
 */
function describeProfileState(profileState) {
  return PROFILE_STATE_LABEL[profileState] || PROFILE_STATE_LABEL[PROFILE_STATE.NONE];
}

module.exports = { toIdentitySnapshot, describeProfileState };

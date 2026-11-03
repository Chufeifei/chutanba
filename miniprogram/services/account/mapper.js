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
const { PROFILE_REVIEW_STATUS } = require('../../config/contracts');

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

/** 资料状态的中文说明，供 P07 直接用。 */
function describeProfileState(profileState) {
  switch (profileState) {
    case PROFILE_REVIEW_STATUS.PENDING:
      return '审核中';
    case PROFILE_REVIEW_STATUS.APPROVED:
      return '已通过';
    case PROFILE_REVIEW_STATUS.REJECTED:
      return '未通过';
    case PROFILE_REVIEW_STATUS.INVALIDATED:
      return '已失效';
    default:
      return '未提交';
  }
}

module.exports = { toIdentitySnapshot, describeProfileState };

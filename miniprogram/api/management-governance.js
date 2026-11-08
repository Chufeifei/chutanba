/**
 * 管理端治理（契约 §5.4）。
 *
 * 治理暂停 / 解除只由 ADMIN / SUPER_ADMIN 执行；服务端逐次校验，
 * P17 的入口可见性不构成权限（AC-13）。
 * 解除治理不清除本人停止公开，也不恢复旧营业位置（AC-11）。
 */
const { get } = require('../utils/request');
const { MANAGEMENT } = require('../config/endpoints');
const { writePost } = require('./core-v2');

function listGovernanceVendors({ keyword, cursor, limit } = {}) {
  return get(MANAGEMENT.VENDORS, { keyword, cursor, limit });
}

/** 治理上下文：双重限制、当前资格、最近处理记录、governanceVersion。 */
function getGovernanceContext(vendorId) {
  return get(MANAGEMENT.GOVERNANCE_CONTEXT(vendorId));
}

function decideGovernance(vendorId, { action, reason, expectedGovernanceVersion } = {}, options) {
  return writePost(MANAGEMENT.GOVERNANCE_DECISIONS(vendorId), {
    action,
    reason,
    expectedGovernanceVersion,
  }, options);
}

module.exports = {
  listGovernanceVendors,
  getGovernanceContext,
  decideGovernance,
};

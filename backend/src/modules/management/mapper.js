/**
 * 管理投影：正向逐字段赋值。
 * 治理上下文与影响记录都不复制反馈人身份、顾客坐标或无关历史位置。
 */
function toContext({ roles, capabilities, counts }) {
  return {
    roles,
    capabilities,
    queueCounts: {
      profileReviews: Number(counts.profileReviews || 0),
      fieldFeedback: Number(counts.fieldFeedback || 0),
      impactReviews: Number(counts.impactReviews || 0),
    },
  };
}

function toVendorSummary(row) {
  return {
    vendorId: String(row.id),
    vendorCode: row.vendor_code,
    vendorName: row.vendor_name === null || row.vendor_name === undefined ? null : row.vendor_name,
    categoryCode: row.category_code === null || row.category_code === undefined ? null : row.category_code,
    lifecycleStatus: row.lifecycle_status,
    governancePaused: row.governance_paused_at_ms !== null && row.governance_paused_at_ms !== undefined,
  };
}

function toAction(row) {
  const item = {
    actionId: String(row.id),
    actionType: row.action_type,
    reason: row.reason,
    effectiveAtMs: Number(row.effective_at_ms),
  };
  if (row.target_session_id !== null && row.target_session_id !== undefined) {
    item.targetSessionId = String(row.target_session_id);
  }
  if (row.source_case_id !== null && row.source_case_id !== undefined) {
    item.sourceCaseId = String(row.source_case_id);
  }
  return item;
}

/** 双重限制分别给出时刻与版本：恢复一方不得掩盖另一方仍然成立。 */
function toControls(controls) {
  const item = {
    selfVersion: controls.selfVersion,
    governanceVersion: controls.governanceVersion,
  };
  if (controls.selfStoppedAtMs !== null) item.selfStoppedAtMs = controls.selfStoppedAtMs;
  if (controls.governancePausedAtMs !== null) item.governancePausedAtMs = controls.governancePausedAtMs;
  return item;
}

function toCurrentSession(row, phase) {
  if (!row) return null;
  return {
    sessionId: String(row.id),
    version: Number(row.version),
    phase: phase.phase,
    remainingMs: phase.remainingMs,
    startedAtMs: Number(row.started_at_ms),
    plannedEndAtMs: Number(row.planned_end_at_ms),
  };
}

function toGovernanceContext({ vendor, controls, eligibility, currentSession, actions }) {
  return {
    vendorId: String(vendor.id),
    vendorCode: vendor.vendor_code,
    vendorName: vendor.vendor_name === null || vendor.vendor_name === undefined ? null : vendor.vendor_name,
    lifecycleStatus: vendor.lifecycle_status,
    controls: toControls(controls),
    eligibility,
    currentSession,
    recentActions: actions.map(toAction),
    governanceVersion: controls.governanceVersion,
  };
}

function toGovernanceResult({ controls, endedSessionId, actionId }) {
  const result = { governanceVersion: controls.governanceVersion };
  if (controls.governancePausedAtMs !== null) result.governancePausedAtMs = controls.governancePausedAtMs;
  if (endedSessionId !== null && endedSessionId !== undefined) result.endedSessionId = String(endedSessionId);
  if (actionId !== null && actionId !== undefined) result.actionId = String(actionId);
  return result;
}

module.exports = {
  toContext, toVendorSummary, toAction, toControls, toCurrentSession, toGovernanceContext, toGovernanceResult,
};

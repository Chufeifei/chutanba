/**
 * 观察投影：正向逐字段赋值，禁止 ...row 展开。
 * 全部 DTO 都不含坐标；候选只给事件摘要与可提交资格，领取结果只给领取状态。
 */
const { eligibleUntilMs } = require('./eligibility');

function toVendorSummary(row) {
  return {
    vendorId: String(row.vendor_id),
    vendorName: row.vendor_name === undefined || row.vendor_name === null ? null : row.vendor_name,
    categoryCode: row.category_code === undefined || row.category_code === null
      ? null : row.category_code,
  };
}

function toClaimResult(row) {
  return {
    observationId: String(row.id),
    eventAtMs: Number(row.event_at_ms),
    vendorSummary: toVendorSummary(row),
    claimStatus: 'CLAIMED',
  };
}

function toCandidate(row, nowMs) {
  const submitted = row.submitted_types
    ? String(row.submitted_types).split(',').filter(Boolean)
    : [];
  return {
    observationId: String(row.id),
    observationVersion: Number(row.version),
    vendorSummary: toVendorSummary(row),
    eventAtMs: Number(row.event_at_ms),
    eligibleUntilMs: eligibleUntilMs(row),
    eligible: nowMs < eligibleUntilMs(row),
    submittedTypes: submitted,
    nextStep: 'REQUEST_LOCATION_CONTEXT',
  };
}

module.exports = { toVendorSummary, toClaimResult, toCandidate };

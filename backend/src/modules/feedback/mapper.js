/**
 * 反馈投影：正向逐字段赋值，禁止 ...row。
 * 三个 DTO 都不得出现 reporter_lat / reporter_lng / distance_m、其他提交者与管理证据。
 */
function toVendorSummary(row) {
  return {
    vendorId: row.vendor_id === undefined || row.vendor_id === null ? null : String(row.vendor_id),
    vendorName: row.vendor_name === undefined || row.vendor_name === null ? null : row.vendor_name,
    categoryCode: row.category_code === undefined || row.category_code === null
      ? null : row.category_code,
  };
}

function toSubmitResult({ factId, caseId, acceptedAtMs, eligibleUntilMs }) {
  return {
    feedbackFactId: String(factId),
    caseId: String(caseId),
    status: 'PENDING',
    acceptedAtMs,
    eligibleUntilMs,
  };
}

/** 待审恒为 PENDING：列表不把待审表述为已成立。 */
function toListItem(row) {
  const item = {
    feedbackFactId: String(row.id),
    caseId: String(row.case_id),
    vendorSummary: toVendorSummary(row),
    type: row.feedback_type,
    status: row.status,
    submittedAtMs: Number(row.submitted_at_ms),
  };
  if (row.status !== 'PENDING') {
    item.resultReason = row.result_reason_code === null || row.result_reason_code === undefined
      ? null : row.result_reason_code;
    item.decidedAtMs = row.closed_at_ms === null || row.closed_at_ms === undefined
      ? null : Number(row.closed_at_ms);
  }
  return item;
}

/** 详情多给本人提交的描述与原事件时刻；仍不含坐标与距离。 */
function toDetail(row) {
  return {
    ...toListItem(row),
    observationId: String(row.observation_id),
    eventAtMs: Number(row.event_at_ms),
    description: row.description === null ? null : row.description,
  };
}

module.exports = { toVendorSummary, toSubmitResult, toListItem, toDetail };

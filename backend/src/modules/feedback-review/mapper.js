/**
 * 管理复核投影：正向逐字段赋值，禁止 ...row。
 * 列表只给摘要；详情才给受限证据（原始坐标与距离），且仅在 MANAGEMENT 审计下返回。
 */
function toVendorSummary(row) {
  return {
    vendorId: String(row.vendor_id),
    vendorName: row.vendor_name === undefined || row.vendor_name === null ? null : row.vendor_name,
    categoryCode: row.category_code === undefined || row.category_code === null ? null : row.category_code,
  };
}

function toCaseSummary(row) {
  const item = {
    caseId: String(row.id),
    status: row.status,
    type: row.feedback_type,
    openedAtMs: Number(row.opened_at_ms),
    vendorSummary: toVendorSummary(row),
    factCount: Number(row.fact_count || 0),
    reporterCount: Number(row.reporter_count || 0),
  };
  if (row.closed_at_ms !== null && row.closed_at_ms !== undefined) {
    item.closedAtMs = Number(row.closed_at_ms);
  }
  return item;
}

/** 证据块与业务摘要分区：坐标只出现在 evidence / locationVersion 下，便于前端按权限裁剪。 */
function toFact(row, currentSessionId) {
  return {
    factId: String(row.id),
    type: row.feedback_type,
    submittedAtMs: Number(row.submitted_at_ms),
    eventAtMs: Number(row.event_at_ms),
    description: row.description === null ? null : row.description,
    evidence: {
      reporterLat: Number(row.reporter_lat),
      reporterLng: Number(row.reporter_lng),
      reporterLocatedAtMs: Number(row.reporter_located_at_ms),
      distanceM: Number(row.distance_m),
    },
    session: {
      sessionId: String(row.session_id),
      startedAtMs: Number(row.started_at_ms),
      plannedEndAtMs: Number(row.planned_end_at_ms),
      endedAtMs: row.ended_at_ms === null ? null : Number(row.ended_at_ms),
      endReason: row.end_reason,
      isCurrent: currentSessionId !== null && String(currentSessionId) === String(row.session_id),
    },
    locationVersion: {
      locationVersionId: String(row.location_version_id),
      versionNo: Number(row.version_no),
      locationName: row.location_name,
      lat: Number(row.location_lat),
      lng: Number(row.location_lng),
      effectiveAtMs: Number(row.effective_at_ms),
      stoppedAtMs: row.stopped_at_ms === null ? null : Number(row.stopped_at_ms),
    },
  };
}

function toFactDecision(row) {
  const item = {
    factId: String(row.fact_id),
    result: row.result,
    reasonCode: row.reason_code,
    decidedAtMs: Number(row.decided_at_ms),
  };
  if (row.reason_text !== null && row.reason_text !== undefined) item.reasonText = row.reason_text;
  return item;
}

function toReview(review, decisions) {
  if (!review) return null;
  return {
    reviewId: String(review.id),
    result: review.result,
    reason: review.reason,
    decidedAtMs: Number(review.decided_at_ms),
    factDecisions: decisions.map(toFactDecision),
  };
}

function toCaseDetail({ summary, facts, review, decisions, currentSessionId }) {
  const item = {
    ...toCaseSummary(summary),
    taskVersion: Number(summary.task_version),
    currentSessionId: currentSessionId === null ? null : String(currentSessionId),
    facts: facts.map((row) => toFact(row, currentSessionId)),
    review: toReview(review, decisions),
  };
  if (summary.result_reason_code) item.resultReason = summary.result_reason_code;
  return item;
}

function toDecisionResult({ caseId, status, confirmedFactIds, impactRecordId, decidedAtMs }) {
  const result = {
    caseId: String(caseId),
    status,
    confirmedFactIds: confirmedFactIds.map(String),
    decidedAtMs,
  };
  if (impactRecordId !== null && impactRecordId !== undefined) result.impactRecordId = String(impactRecordId);
  return result;
}

function toCorrectionResult({ sessionId, endedAtMs, actionId }) {
  return {
    sessionId: String(sessionId),
    endedAtMs,
    endReason: 'CORRECTION',
    actionId: String(actionId),
  };
}

module.exports = {
  toCaseSummary,
  toCaseDetail,
  toDecisionResult,
  toCorrectionResult,
  toFact,
  toReview,
};

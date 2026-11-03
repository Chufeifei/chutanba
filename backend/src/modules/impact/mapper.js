/**
 * 影响记录读模型：摊主本人只看到摘要、来源与复核期限。
 * 不查询 cb_feedback_fact、cb_feedback_observation，因此不可能带出反馈人身份或坐标。
 * vendor_id 是复核申请的归属校验依据：缺了它就无法判断影响记录是否属于本人摊主。
 */
const COLUMNS = `r.id, r.vendor_id, r.source_type, r.source_id, r.summary, r.status,
  r.created_at_ms, r.reviewable_until_ms, r.version`;

/** 复核申请行的显式列：不含影响记录正文，也不含任何证据内容。 */
const REVIEW_COLUMNS = `r.id, r.vendor_id, r.impact_record_id, r.statement, r.status, r.task_version,
  r.state_version, r.decision_reason, r.actor_account_id, r.created_at_ms, r.decided_at_ms`;

/** 管理队列的摘要列：摊主摘要与影响摘要，不含反馈人身份与坐标。 */
const MANAGEMENT_REVIEW_COLUMNS = `r.id, r.vendor_id, r.impact_record_id, r.statement, r.status,
  r.task_version, r.created_at_ms, r.decided_at_ms, r.decision_reason,
  v.vendor_code, p.vendor_name, i.source_type, i.source_id, i.summary AS impact_summary,
  i.status AS impact_status, i.version AS impact_version`;

const SOURCE_LABELS = Object.freeze({
  FEEDBACK_CASE: '现场反馈核实成立',
  MANAGEMENT_ACTION: '管理处理措施',
});

function toListItem(row) {
  return {
    impactRecordId: String(row.id),
    sourceType: row.source_type,
    sourceLabel: SOURCE_LABELS[row.source_type] || row.source_type,
    summary: row.summary,
    status: row.status,
    createdAtMs: Number(row.created_at_ms),
    reviewableUntilMs: Number(row.reviewable_until_ms),
    impactVersion: Number(row.version),
  };
}

/** 本人视角的复核申请：内容、状态与本人可见理由，不含内部证据与第三人身份。 */
function toReviewItem(row) {
  return {
    impactReviewId: String(row.id),
    impactRecordId: String(row.impact_record_id),
    status: row.status,
    statement: row.statement,
    submittedAtMs: Number(row.created_at_ms),
    taskVersion: Number(row.task_version),
    decisionReason: row.decision_reason === null || row.decision_reason === undefined
      ? null : row.decision_reason,
    decidedAtMs: row.decided_at_ms === null || row.decided_at_ms === undefined
      ? null : Number(row.decided_at_ms),
  };
}

/** 管理列表只给摘要；决定操作所需的 taskVersion 一并给出。 */
function toManagementReviewSummary(row) {
  return {
    impactReviewId: String(row.id),
    vendorId: String(row.vendor_id),
    vendorCode: row.vendor_code,
    vendorName: row.vendor_name === null || row.vendor_name === undefined ? null : row.vendor_name,
    impactRecordId: String(row.impact_record_id),
    impactSourceType: row.source_type,
    impactSourceId: String(row.source_id),
    impactSummary: row.impact_summary,
    impactStatus: row.impact_status,
    impactVersion: Number(row.impact_version),
    status: row.status,
    submittedAtMs: Number(row.created_at_ms),
    taskVersion: Number(row.task_version),
  };
}

function toManagementReviewDetail(row) {
  return {
    ...toManagementReviewSummary(row),
    statement: row.statement,
    decisionReason: row.decision_reason === null || row.decision_reason === undefined
      ? null : row.decision_reason,
    decidedAtMs: row.decided_at_ms === null || row.decided_at_ms === undefined
      ? null : Number(row.decided_at_ms),
  };
}

module.exports = {
  COLUMNS, REVIEW_COLUMNS, MANAGEMENT_REVIEW_COLUMNS, SOURCE_LABELS,
  toListItem, toReviewItem, toManagementReviewSummary, toManagementReviewDetail,
};

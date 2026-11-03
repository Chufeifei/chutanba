/**
 * 影响记录读模型：摊主本人只看到摘要、来源与复核期限。
 * 不查询 cb_feedback_fact、cb_feedback_observation，因此不可能带出反馈人身份或坐标。
 */
const COLUMNS = `r.id, r.source_type, r.source_id, r.summary, r.status,
  r.created_at_ms, r.reviewable_until_ms, r.version`;

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

module.exports = { COLUMNS, SOURCE_LABELS, toListItem };

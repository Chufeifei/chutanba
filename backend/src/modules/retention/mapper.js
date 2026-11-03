/**
 * 保留挂起读模型：行 → 对外对象。
 * 只暴露挂起本身（对象、来源、依据、期限），不带任何证据正文。
 */
const COLUMNS = `id, target_type, target_id, source_type, source_id, basis,
  opened_at_ms, closed_at_ms, extended_due_at_ms`;

function toHold(row) {
  return {
    holdId: String(row.id),
    targetType: row.target_type,
    targetId: String(row.target_id),
    sourceType: row.source_type,
    sourceId: String(row.source_id),
    basis: row.basis,
    openedAtMs: Number(row.opened_at_ms),
    closedAtMs: row.closed_at_ms === null ? null : Number(row.closed_at_ms),
    extendedDueAtMs: row.extended_due_at_ms === null ? null : Number(row.extended_due_at_ms),
  };
}

module.exports = { COLUMNS, toHold };

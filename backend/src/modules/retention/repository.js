/**
 * 保留挂起存储：只写 SQL，事务由调用方持有。
 * 唯一键 (target_type,target_id,source_type,source_id) 由 0014 迁移提供，
 * 挂起登记天然幂等。
 */
const { COLUMNS } = require('./mapper');

// 目标 ID 数量不定时按批取：动态部分只有占位符个数，取值仍全部走参数化，
// 任何取值都不拼进 SQL 文本。
const CHUNK_SIZE = 100;

async function findHold(connection, { targetType, targetId, sourceType, sourceId }) {
  const [rows] = await connection.execute(
    `SELECT ${COLUMNS} FROM cb_retention_hold
     WHERE target_type = ? AND target_id = ? AND source_type = ? AND source_id = ?`,
    [targetType, targetId, sourceType, sourceId],
  );
  return rows[0] || null;
}

async function insertHold(connection, {
  targetType, targetId, sourceType, sourceId, basis, openedAtMs,
}) {
  const [result] = await connection.execute(
    `INSERT INTO cb_retention_hold
       (target_type, target_id, source_type, source_id, basis, opened_at_ms, state_version)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [targetType, targetId, sourceType, sourceId, basis, openedAtMs],
  );
  return Number(result.insertId);
}

async function listHoldsByTargets(connection, { targetType, targetIds }) {
  const ids = (targetIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return [];
  const rows = [];
  for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
    const chunk = ids.slice(index, index + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const [result] = await connection.execute(
      `SELECT ${COLUMNS} FROM cb_retention_hold
       WHERE target_type = ? AND target_id IN (${placeholders})`,
      [targetType, ...chunk],
    );
    rows.push(...result);
  }
  return rows;
}

async function closeHoldsBySource(connection, { sourceType, sourceId, closedAtMs, extendedDueAtMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_retention_hold
     SET closed_at_ms = ?, extended_due_at_ms = ?, state_version = state_version + 1
     WHERE source_type = ? AND source_id = ? AND closed_at_ms IS NULL`,
    [closedAtMs, extendedDueAtMs, sourceType, sourceId],
  );
  return result.affectedRows;
}

module.exports = { findHold, insertHold, listHoldsByTargets, closeHoldsBySource };

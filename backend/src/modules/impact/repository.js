/**
 * 影响记录存储：来源唯一键 (source_type, source_id) 保证同一来源只生成一条记录。
 * 只写 SQL，事务由调用方持有。
 */
const { COLUMNS } = require('./mapper');

async function findVendorIdByAccount(connection, accountId) {
  const [rows] = await connection.execute(
    "SELECT id FROM cb_vendor_identity WHERE active_account_id = ? AND lifecycle_status = 'ACTIVE' LIMIT 1",
    [accountId],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

async function findBySource(connection, { sourceType, sourceId }) {
  const [rows] = await connection.execute(
    `SELECT ${COLUMNS} FROM cb_vendor_impact_record r
     WHERE r.source_type = ? AND r.source_id = ?`,
    [sourceType, sourceId],
  );
  return rows[0] || null;
}

async function insertRecord(connection, {
  vendorId, sourceType, sourceId, summary, status, createdAtMs, reviewableUntilMs,
}) {
  const [result] = await connection.execute(
    `INSERT INTO cb_vendor_impact_record
       (vendor_id, source_type, source_id, summary, status, created_at_ms, reviewable_until_ms, version, state_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [vendorId, sourceType, sourceId, summary, status, createdAtMs, reviewableUntilMs],
  );
  return Number(result.insertId);
}

async function listForVendor(connection, { vendorId, cursor, limit }) {
  const params = [vendorId];
  let cursorClause = '';
  if (cursor) {
    cursorClause = 'AND (r.created_at_ms < ? OR (r.created_at_ms = ? AND r.id < ?))';
    params.push(cursor.createdAtMs, cursor.createdAtMs, cursor.impactRecordId);
  }
  // 预编译语句不接受 LIMIT ?：上限已在 schema 校验为 1～50 的整数，直接内联。
  const [rows] = await connection.execute(
    `SELECT ${COLUMNS} FROM cb_vendor_impact_record r
     WHERE r.vendor_id = ? ${cursorClause}
     ORDER BY r.created_at_ms DESC, r.id DESC
     LIMIT ${Number(limit) + 1}`,
    params,
  );
  return rows;
}

module.exports = { findVendorIdByAccount, findBySource, insertRecord, listForVendor };

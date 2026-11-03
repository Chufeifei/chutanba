/**
 * 影响记录存储：来源唯一键 (source_type, source_id) 保证同一来源只生成一条记录。
 * 复核申请由同一域持有：写入与读取都在这里，事务由调用方传入。
 * 只写 SQL，事务由调用方持有。
 */
const { COLUMNS, REVIEW_COLUMNS, MANAGEMENT_REVIEW_COLUMNS } = require('./mapper');

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

/** 锁行读影响记录：复核申请与复核决定都以它为并发基准。 */
async function findByIdForUpdate(connection, impactRecordId) {
  const [rows] = await connection.execute(
    `SELECT ${COLUMNS} FROM cb_vendor_impact_record r WHERE r.id = ? LIMIT 1 FOR UPDATE`,
    [impactRecordId],
  );
  return rows[0] || null;
}

/** 只读影响记录：幂等回放读取当前状态用。 */
async function findById(connection, impactRecordId) {
  const [rows] = await connection.execute(
    `SELECT ${COLUMNS} FROM cb_vendor_impact_record r WHERE r.id = ? LIMIT 1`,
    [impactRecordId],
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

/** 复核决定撤销影响：只改状态与版本，不删原反馈事实与处理历史。 */
async function updateStatus(connection, { impactRecordId, status }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_impact_record
     SET status = ?, version = version + 1, state_version = state_version + 1
     WHERE id = ?`,
    [status, impactRecordId],
  );
  return result.affectedRows;
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

/** 同一影响的未结复核：唯一键保证只留一份，查询用于给出明确冲突。 */
async function findPendingReviewByImpact(connection, impactRecordId) {
  const [rows] = await connection.execute(
    `SELECT ${REVIEW_COLUMNS} FROM cb_vendor_impact_review_request r
     WHERE r.impact_record_id = ? AND r.status = 'PENDING' LIMIT 1`,
    [impactRecordId],
  );
  return rows[0] || null;
}

async function insertReviewRequest(connection, {
  vendorId, impactRecordId, statement, createdAtMs,
}) {
  const [result] = await connection.execute(
    `INSERT INTO cb_vendor_impact_review_request
       (vendor_id, impact_record_id, statement, status, task_version, state_version, created_at_ms)
     VALUES (?, ?, ?, 'PENDING', 1, 1, ?)`,
    [vendorId, impactRecordId, statement, createdAtMs],
  );
  return Number(result.insertId);
}

async function findReviewById(connection, reviewId) {
  const [rows] = await connection.execute(
    `SELECT ${REVIEW_COLUMNS} FROM cb_vendor_impact_review_request r WHERE r.id = ? LIMIT 1`,
    [reviewId],
  );
  return rows[0] || null;
}

async function findReviewByIdForUpdate(connection, reviewId) {
  const [rows] = await connection.execute(
    `SELECT ${REVIEW_COLUMNS} FROM cb_vendor_impact_review_request r WHERE r.id = ? LIMIT 1 FOR UPDATE`,
    [reviewId],
  );
  return rows[0] || null;
}

async function listReviewsForVendor(connection, { vendorId, cursor, limit }) {
  const params = [vendorId];
  let cursorClause = '';
  if (cursor) {
    cursorClause = 'AND (r.created_at_ms < ? OR (r.created_at_ms = ? AND r.id < ?))';
    params.push(cursor.createdAtMs, cursor.createdAtMs, cursor.reviewId);
  }
  const [rows] = await connection.execute(
    `SELECT ${REVIEW_COLUMNS} FROM cb_vendor_impact_review_request r
     WHERE r.vendor_id = ? ${cursorClause}
     ORDER BY r.created_at_ms DESC, r.id DESC
     LIMIT ${Number(limit) + 1}`,
    params,
  );
  return rows;
}

/** 管理队列按状态筛选 + 游标；只返回摘要所需的列。 */
async function listReviewsForManagement(connection, { status, cursor, limit }) {
  const params = [];
  const clauses = [];
  if (status) {
    clauses.push('r.status = ?');
    params.push(status);
  }
  if (cursor) {
    clauses.push('(r.created_at_ms < ? OR (r.created_at_ms = ? AND r.id < ?))');
    params.push(cursor.createdAtMs, cursor.createdAtMs, cursor.reviewId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await connection.execute(
    `SELECT ${MANAGEMENT_REVIEW_COLUMNS}
     FROM cb_vendor_impact_review_request r
     JOIN cb_vendor_identity v ON v.id = r.vendor_id
     JOIN cb_vendor_impact_record i ON i.id = r.impact_record_id
     LEFT JOIN cb_vendor_profile_version p ON p.id = v.active_profile_version_id
     ${where}
     ORDER BY r.created_at_ms DESC, r.id DESC
     LIMIT ${Number(limit) + 1}`,
    params,
  );
  return rows;
}

async function findManagementReviewById(connection, reviewId) {
  const [rows] = await connection.execute(
    `SELECT ${MANAGEMENT_REVIEW_COLUMNS}
     FROM cb_vendor_impact_review_request r
     JOIN cb_vendor_identity v ON v.id = r.vendor_id
     JOIN cb_vendor_impact_record i ON i.id = r.impact_record_id
     LEFT JOIN cb_vendor_profile_version p ON p.id = v.active_profile_version_id
     WHERE r.id = ? LIMIT 1`,
    [reviewId],
  );
  return rows[0] || null;
}

/** 结案：同一复核申请只成立一个终态决定。 */
async function closeReview(connection, {
  reviewId, status, decisionReason, actorAccountId, decidedAtMs,
}) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_impact_review_request
     SET status = ?, decision_reason = ?, actor_account_id = ?, decided_at_ms = ?,
         task_version = task_version + 1, state_version = state_version + 1
     WHERE id = ? AND status = 'PENDING'`,
    [status, decisionReason, actorAccountId, decidedAtMs, reviewId],
  );
  return result.affectedRows;
}

/** 摊主的已成立影响数量：清除预览要说明哪些处理历史不会被删除。 */
async function countRecordsByVendor(connection, vendorId) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS total FROM cb_vendor_impact_record WHERE vendor_id = ?',
    [vendorId],
  );
  return Number(rows[0].total);
}

/** 摊主的未结影响复核数量：未结复核期间相关证据不得清理。 */
async function countOpenReviewsByVendor(connection, vendorId) {
  const [rows] = await connection.execute(
    "SELECT COUNT(*) AS total FROM cb_vendor_impact_review_request WHERE vendor_id = ? AND status = 'PENDING'",
    [vendorId],
  );
  return Number(rows[0].total);
}

module.exports = {
  findVendorIdByAccount, findBySource, findById, findByIdForUpdate, insertRecord, updateStatus,
  listForVendor, findPendingReviewByImpact, insertReviewRequest, findReviewById,
  findReviewByIdForUpdate, listReviewsForVendor, listReviewsForManagement,
  findManagementReviewById, closeReview, countRecordsByVendor, countOpenReviewsByVendor,
};

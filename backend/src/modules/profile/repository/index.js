/**
 * 资料域唯一写库方：全部参数化、显式列，不开事务、不做权限或业务判断。
 * 事务连接由 service 通过 withTransaction 统一传入。
 * 清除相关写库方另存 clearance.js，本文件只做汇总转出。
 */
const clearance = require('./clearance');

/** 首次提交按账号行串行化，避免并发创建两条摊主身份。 */
async function lockAccount(connection, accountId) {
  await connection.execute('SELECT id FROM cb_user_account WHERE id = ? FOR UPDATE', [accountId]);
}

async function findVendorByAccount(connection, accountId) {
  const [rows] = await connection.execute(
    `SELECT id, lifecycle_status, active_profile_version_id, state_version
     FROM cb_vendor_identity WHERE active_account_id = ? LIMIT 1`,
    [accountId],
  );
  return rows[0] || null;
}

async function findVendorByAccountForUpdate(connection, accountId) {
  const [rows] = await connection.execute(
    `SELECT id, lifecycle_status, active_profile_version_id, state_version
     FROM cb_vendor_identity WHERE active_account_id = ? FOR UPDATE`,
    [accountId],
  );
  return rows[0] || null;
}

async function findVendorById(connection, vendorId) {
  const [rows] = await connection.execute(
    `SELECT id, lifecycle_status, active_profile_version_id, state_version
     FROM cb_vendor_identity WHERE id = ? LIMIT 1`,
    [vendorId],
  );
  return rows[0] || null;
}

async function findVendorByIdForUpdate(connection, vendorId) {
  const [rows] = await connection.execute(
    `SELECT id, lifecycle_status, active_profile_version_id, state_version
     FROM cb_vendor_identity WHERE id = ? FOR UPDATE`,
    [vendorId],
  );
  return rows[0] || null;
}

/** vendor_code 由服务端在事务内生成，插入时先用账号级占位值满足唯一非空约束。 */
async function insertVendor(connection, { accountId, placeholderCode, nowMs }) {
  const [result] = await connection.execute(
    `INSERT INTO cb_vendor_identity
       (account_id, vendor_code, lifecycle_status, state_version, created_at_ms, updated_at_ms)
     VALUES (?, ?, 'ACTIVE', 1, ?, ?)`,
    [accountId, placeholderCode, nowMs, nowMs],
  );
  return Number(result.insertId);
}

async function updateVendorCode(connection, { vendorId, vendorCode }) {
  const [result] = await connection.execute(
    'UPDATE cb_vendor_identity SET vendor_code = ? WHERE id = ?',
    [vendorCode, vendorId],
  );
  return result.affectedRows;
}

async function updateVendorStateVersion(connection, { vendorId, nowMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_identity
     SET state_version = state_version + 1, updated_at_ms = ?
     WHERE id = ?`,
    [nowMs, vendorId],
  );
  return result.affectedRows;
}

async function setActiveProfileVersion(connection, { vendorId, versionId, nowMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_identity
     SET active_profile_version_id = ?, state_version = state_version + 1, updated_at_ms = ?
     WHERE id = ?`,
    [versionId, nowMs, vendorId],
  );
  return result.affectedRows;
}

async function findLatestVersionNoForUpdate(connection, vendorId) {
  const [rows] = await connection.execute(
    `SELECT version_no FROM cb_vendor_profile_version
     WHERE vendor_id = ? ORDER BY version_no DESC LIMIT 1 FOR UPDATE`,
    [vendorId],
  );
  return rows.length ? Number(rows[0].version_no) : null;
}

async function findPendingVersionForUpdate(connection, vendorId) {
  const [rows] = await connection.execute(
    `SELECT id FROM cb_vendor_profile_version
     WHERE vendor_id = ? AND review_status = 'PENDING' LIMIT 1 FOR UPDATE`,
    [vendorId],
  );
  return rows[0] || null;
}

async function findPendingVersion(connection, vendorId) {
  const [rows] = await connection.execute(
    `SELECT id, vendor_id, version_no, task_version, state_version, vendor_name,
            category_code, regular_items_text, price_description, announcement,
            review_status, submitted_at_ms, decided_at_ms
     FROM cb_vendor_profile_version
     WHERE vendor_id = ? AND review_status = 'PENDING' LIMIT 1`,
    [vendorId],
  );
  return rows[0] || null;
}

async function findVersionById(connection, versionId) {
  const [rows] = await connection.execute(
    `SELECT id, vendor_id, version_no, task_version, state_version, vendor_name,
            category_code, regular_items_text, price_description, announcement,
            review_status, submitted_at_ms, decided_at_ms
     FROM cb_vendor_profile_version WHERE id = ? LIMIT 1`,
    [versionId],
  );
  return rows[0] || null;
}

async function findVersionByIdForUpdate(connection, versionId) {
  const [rows] = await connection.execute(
    `SELECT id, vendor_id, version_no, task_version, state_version, vendor_name,
            category_code, regular_items_text, price_description, announcement,
            review_status, submitted_at_ms, decided_at_ms
     FROM cb_vendor_profile_version WHERE id = ? FOR UPDATE`,
    [versionId],
  );
  return rows[0] || null;
}

async function insertPendingVersion(connection, { vendorId, versionNo, input, submittedAtMs }) {
  const [result] = await connection.execute(
    `INSERT INTO cb_vendor_profile_version
       (vendor_id, version_no, task_version, state_version, vendor_name, category_code,
        regular_items_text, price_description, announcement, review_status, submitted_at_ms)
     VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?, 'PENDING', ?)`,
    [vendorId, versionNo, input.vendorName, input.categoryCode, input.regularItemsText,
      input.priceDescription, input.announcement, submittedAtMs],
  );
  return Number(result.insertId);
}

async function markVersionDecided(connection, { versionId, reviewStatus, decidedAtMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_profile_version
     SET review_status = ?, decided_at_ms = ?, task_version = task_version + 1,
         state_version = state_version + 1
     WHERE id = ? AND review_status = 'PENDING'`,
    [reviewStatus, decidedAtMs, versionId],
  );
  return result.affectedRows;
}

async function insertReviewEvent(connection, { versionId, decision, reason, actorAccountId, decidedAtMs, operationId }) {
  const [result] = await connection.execute(
    `INSERT INTO cb_profile_review_event
       (profile_version_id, decision, reason, actor_account_id, decided_at_ms, operation_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [versionId, decision, reason, actorAccountId, decidedAtMs, operationId],
  );
  return Number(result.insertId);
}

async function findReviewEvent(connection, versionId) {
  const [rows] = await connection.execute(
    `SELECT id, profile_version_id, decision, reason, actor_account_id, decided_at_ms
     FROM cb_profile_review_event WHERE profile_version_id = ? LIMIT 1`,
    [versionId],
  );
  return rows[0] || null;
}

async function findReviewHistory(connection, versionId) {
  const [rows] = await connection.execute(
    `SELECT id, profile_version_id, decision, reason, actor_account_id, decided_at_ms
     FROM cb_profile_review_event WHERE profile_version_id = ?
     ORDER BY decided_at_ms DESC, id DESC`,
    [versionId],
  );
  return rows;
}

/** 最近一次已决定版本，联审核事件取本人可见驳回原因。 */
async function findLatestDecidedVersion(connection, vendorId) {
  const [rows] = await connection.execute(
    `SELECT p.id, p.vendor_id, p.version_no, p.review_status, p.decided_at_ms,
            v.active_profile_version_id, e.reason AS decision_reason
     FROM cb_vendor_profile_version p
     JOIN cb_vendor_identity v ON v.id = p.vendor_id
     LEFT JOIN cb_profile_review_event e ON e.profile_version_id = p.id
     WHERE p.vendor_id = ? AND p.review_status <> 'PENDING'
     ORDER BY p.decided_at_ms DESC, p.id DESC
     LIMIT 1`,
    [vendorId],
  );
  return rows[0] || null;
}

/** 管理队列按 (submitted_at_ms, id) 倒序；cursor 只影响参数值，SQL 结构固定。 */
async function findReviewQueue(connection, { status, cursor, limit }) {
  // LIMIT 在部分 MySQL 版本无法绑定预处理参数；schema 上限 100，service 额外取 1 条探测下一页，此处只做整数兜底。
  if (!Number.isInteger(limit) || limit < 1 || limit > 101) throw new TypeError('资料审核队列 limit 不合法');
  if (cursor) {
    const [rows] = await connection.execute(
      `SELECT p.id, p.vendor_id, p.vendor_name, p.version_no, p.task_version,
              p.submitted_at_ms, p.review_status, v.active_profile_version_id,
              a.vendor_name AS active_name
       FROM cb_vendor_profile_version p
       JOIN cb_vendor_identity v ON v.id = p.vendor_id
       LEFT JOIN cb_vendor_profile_version a ON a.id = v.active_profile_version_id
       WHERE p.review_status = ?
         AND (p.submitted_at_ms < ? OR (p.submitted_at_ms = ? AND p.id < ?))
       ORDER BY p.submitted_at_ms DESC, p.id DESC
       LIMIT ${limit}`,
      [status, cursor.submittedAtMs, cursor.submittedAtMs, cursor.id],
    );
    return rows;
  }
  const [rows] = await connection.execute(
    `SELECT p.id, p.vendor_id, p.vendor_name, p.version_no, p.task_version,
            p.submitted_at_ms, p.review_status, v.active_profile_version_id,
            a.vendor_name AS active_name
     FROM cb_vendor_profile_version p
     JOIN cb_vendor_identity v ON v.id = p.vendor_id
     LEFT JOIN cb_vendor_profile_version a ON a.id = v.active_profile_version_id
     WHERE p.review_status = ?
     ORDER BY p.submitted_at_ms DESC, p.id DESC
     LIMIT ${limit}`,
    [status],
  );
  return rows;
}

module.exports = {
  lockAccount,
  findVendorByAccount, findVendorByAccountForUpdate, findVendorById, findVendorByIdForUpdate,
  insertVendor, updateVendorCode, updateVendorStateVersion, setActiveProfileVersion,
  findLatestVersionNoForUpdate, findPendingVersionForUpdate, findPendingVersion,
  findVersionById, findVersionByIdForUpdate, insertPendingVersion, markVersionDecided,
  insertReviewEvent, findReviewEvent, findReviewHistory, findLatestDecidedVersion, findReviewQueue,
  ...clearance,
};

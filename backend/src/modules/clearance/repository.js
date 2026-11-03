/**
 * 清除请求存储：只写 SQL，事务由调用方持有。
 * scope_json 记录「请求范围 + 实际生效范围 + 受影响类别」，回放与查询都按它还原。
 */
const COLUMNS = `r.id, r.account_id, r.vendor_id, r.scope_json, r.status, r.accepted_at_ms,
  r.due_at_ms, r.completed_at_ms, r.result_summary_json, r.state_version`;

async function insertRequest(connection, {
  accountId, vendorId, scopeJson, status, acceptedAtMs, dueAtMs,
}) {
  const [result] = await connection.execute(
    `INSERT INTO cb_data_clear_request
       (account_id, vendor_id, scope_json, status, accepted_at_ms, due_at_ms, state_version)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [accountId, vendorId === null ? null : vendorId, JSON.stringify(scopeJson), status, acceptedAtMs, dueAtMs],
  );
  return Number(result.insertId);
}

async function findRequestById(connection, requestId) {
  const [rows] = await connection.execute(
    `SELECT ${COLUMNS} FROM cb_data_clear_request r WHERE r.id = ? LIMIT 1`,
    [requestId],
  );
  return rows[0] || null;
}

async function findRequestByIdForUpdate(connection, requestId) {
  const [rows] = await connection.execute(
    `SELECT ${COLUMNS} FROM cb_data_clear_request r WHERE r.id = ? LIMIT 1 FOR UPDATE`,
    [requestId],
  );
  return rows[0] || null;
}

async function listRequestsForAccount(connection, { accountId, cursor, limit }) {
  const params = [accountId];
  let cursorClause = '';
  if (cursor) {
    cursorClause = 'AND (r.accepted_at_ms < ? OR (r.accepted_at_ms = ? AND r.id < ?))';
    params.push(cursor.acceptedAtMs, cursor.acceptedAtMs, cursor.requestId);
  }
  const [rows] = await connection.execute(
    `SELECT ${COLUMNS} FROM cb_data_clear_request r
     WHERE r.account_id = ? ${cursorClause}
     ORDER BY r.accepted_at_ms DESC, r.id DESC
     LIMIT ${Number(limit) + 1}`,
    params,
  );
  return rows;
}

/** 待处理队列：清理作业（W12）按稳定游标取，本包只提供读方法。 */
async function listQueuedRequests(connection, { limit }) {
  const [rows] = await connection.execute(
    `SELECT ${COLUMNS} FROM cb_data_clear_request r
     WHERE r.status IN ('QUEUED','IN_PROGRESS')
     ORDER BY r.accepted_at_ms ASC, r.id ASC
     LIMIT ${Number(limit)}`,
  );
  return rows;
}

async function markInProgress(connection, { requestId }) {
  const [result] = await connection.execute(
    `UPDATE cb_data_clear_request
     SET status = 'IN_PROGRESS', state_version = state_version + 1
     WHERE id = ? AND status = 'QUEUED'`,
    [requestId],
  );
  return result.affectedRows;
}

/** 写终态：完成或部分失败都要落库，失败原因与可重试标记进结果摘要。 */
async function markFinished(connection, { requestId, status, completedAtMs, resultSummaryJson }) {
  const [result] = await connection.execute(
    `UPDATE cb_data_clear_request
     SET status = ?, completed_at_ms = ?, result_summary_json = ?, state_version = state_version + 1
     WHERE id = ? AND status <> 'COMPLETED'`,
    [status, completedAtMs, JSON.stringify(resultSummaryJson), requestId],
  );
  return result.affectedRows;
}

module.exports = {
  insertRequest, findRequestById, findRequestByIdForUpdate, listRequestsForAccount,
  listQueuedRequests, markInProgress, markFinished,
};

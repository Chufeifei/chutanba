/** 幂等操作按 (actor_scope, operation_type, key_hash) 唯一识别；不存明文键。 */

async function findOperation(connection, { actorScope, operationType, keyHash }) {
  const [rows] = await connection.execute(
    `SELECT id, request_hash, status, result_ref, error_code
     FROM cb_idempotency_operation
     WHERE actor_scope = ? AND operation_type = ? AND key_hash = ? LIMIT 1`,
    [actorScope, operationType, keyHash],
  );
  return rows[0] || null;
}

async function insertPending(connection, { actorScope, operationType, keyHash, requestHash, nowMs }) {
  const [result] = await connection.execute(
    `INSERT INTO cb_idempotency_operation
       (actor_scope, operation_type, key_hash, request_hash, status, created_at_ms)
     VALUES (?, ?, ?, ?, 'PENDING', ?)`,
    [actorScope, operationType, keyHash, requestHash, nowMs],
  );
  return Number(result.insertId);
}

async function markSucceeded(connection, { operationId, resultRef, completedAtMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_idempotency_operation
     SET status = 'SUCCEEDED', result_ref = ?, completed_at_ms = ?, state_version = state_version + 1
     WHERE id = ? AND status = 'PENDING'`,
    [resultRef, completedAtMs, operationId],
  );
  return result.affectedRows;
}

async function markFailed(connection, { operationId, errorCode, completedAtMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_idempotency_operation
     SET status = 'FAILED', error_code = ?, completed_at_ms = ?, state_version = state_version + 1
     WHERE id = ? AND status = 'PENDING'`,
    [errorCode, completedAtMs, operationId],
  );
  return result.affectedRows;
}

module.exports = { findOperation, insertPending, markSucceeded, markFailed };

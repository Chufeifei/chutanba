/**
 * 定位上下文只存令牌摘要；一次性消费靠 used_at_ms 条件更新保证。
 * 不开事务、不做归属判断（归属由 OPEN/REFRESH 各自的业务域校验）。
 */
async function insert(connection, {
  tokenHash, accountId, purpose, targetId, issuedAtMs, expiresAtMs,
}) {
  const [result] = await connection.execute(
    `INSERT INTO cb_location_context
       (token_hash, account_id, purpose, target_id, issued_at_ms, expires_at_ms, state_version)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [tokenHash, accountId, purpose, targetId, issuedAtMs, expiresAtMs],
  );
  return Number(result.insertId);
}

async function findById(connection, contextId) {
  const [rows] = await connection.execute(
    `SELECT id, token_hash, account_id, purpose, target_id, issued_at_ms, expires_at_ms, used_at_ms
     FROM cb_location_context WHERE id = ? LIMIT 1`,
    [contextId],
  );
  return rows[0] || null;
}

async function findByHashForUpdate(connection, tokenHash) {
  const [rows] = await connection.execute(
    `SELECT id, token_hash, account_id, purpose, target_id, issued_at_ms, expires_at_ms, used_at_ms
     FROM cb_location_context WHERE token_hash = ? LIMIT 1 FOR UPDATE`,
    [tokenHash],
  );
  return rows[0] || null;
}

/** 条件更新保证“一次性”：已使用的上下文 affectedRows 为 0，由 service 映射为 CONTEXT_EXPIRED。 */
async function markUsed(connection, { contextId, usedAtMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_location_context
     SET used_at_ms = ?, state_version = state_version + 1
     WHERE id = ? AND used_at_ms IS NULL AND expires_at_ms >= ?`,
    [usedAtMs, contextId, usedAtMs],
  );
  return result.affectedRows;
}

module.exports = { insert, findById, findByHashForUpdate, markUsed };

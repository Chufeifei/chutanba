/**
 * 账号表是账号域的唯一写入方；cb_vendor_identity 目前只读，
 * 摊主资格与账号资格互不推导，后续摊主域拥有该表写入权。
 */

async function findByOpenid(connection, openid) {
  const [rows] = await connection.execute(
    `SELECT id, wx_openid, wx_unionid, status, version, state_version, created_at_ms, updated_at_ms
     FROM cb_user_account WHERE wx_openid = ? LIMIT 1`,
    [openid],
  );
  return rows[0] || null;
}

async function findById(connection, accountId) {
  const [rows] = await connection.execute(
    `SELECT id, wx_openid, wx_unionid, status, version, state_version, created_at_ms, updated_at_ms
     FROM cb_user_account WHERE id = ? LIMIT 1`,
    [accountId],
  );
  return rows[0] || null;
}

async function insertAccount(connection, { openid, unionid, nowMs }) {
  const [result] = await connection.execute(
    `INSERT INTO cb_user_account (wx_openid, wx_unionid, status, version, state_version, created_at_ms, updated_at_ms)
     VALUES (?, ?, 'ACTIVE', 1, 1, ?, ?)`,
    [openid, unionid, nowMs, nowMs],
  );
  return Number(result.insertId);
}

/** 活跃摊主身份由生成列 active_account_id 保证唯一；无摊主返回 null。 */
async function findActiveVendorId(connection, accountId) {
  const [rows] = await connection.execute(
    'SELECT id FROM cb_vendor_identity WHERE active_account_id = ? LIMIT 1',
    [accountId],
  );
  return rows.length ? Number(rows[0].id) : null;
}

/** 锁账号行：同一账号的清除请求串行化，账号版本比对也在锁内做。 */
async function lockAccount(connection, accountId) {
  const [rows] = await connection.execute(
    'SELECT id, wx_openid, status, version, state_version, created_at_ms, updated_at_ms FROM cb_user_account WHERE id = ? FOR UPDATE',
    [accountId],
  );
  return rows[0] || null;
}

/**
 * 清空非必要账号资料（昵称、头像、手机号）：本人清除请求的 ACCOUNT_DATA 范围。
 * 登录关联 wx_openid / wx_unionid 永远保留——它们是身份，不是可清除的资料。
 */
async function clearProfileFields(connection, { accountId, nowMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_user_account
     SET nickname = NULL, avatar_url = NULL, phone = NULL, updated_at_ms = ?
     WHERE id = ? AND (nickname IS NOT NULL OR avatar_url IS NOT NULL OR phone IS NOT NULL)`,
    [nowMs, accountId],
  );
  return result.affectedRows;
}

module.exports = {
  findByOpenid, findById, insertAccount, findActiveVendorId, lockAccount, clearProfileFields,
};

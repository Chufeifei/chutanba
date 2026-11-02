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

module.exports = { findByOpenid, findById, insertAccount, findActiveVendorId };

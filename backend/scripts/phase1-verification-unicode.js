const assert = require('node:assert/strict');

async function checkUnicode(connection) {
  await connection.query(
    'INSERT INTO cb_user_account (wx_openid,nickname,created_at_ms,updated_at_ms) VALUES (?,?,1000,1000)',
    ['phase1-emoji-😀', '摊主😀'],
  );
  const [[row]] = await connection.query(
    'SELECT nickname FROM cb_user_account WHERE wx_openid = ?', ['phase1-emoji-😀'],
  );
  assert.equal(row.nickname, '摊主😀');
  for (const openid of ['Phase1-Case', 'phase1-case']) {
    await connection.query(
      'INSERT INTO cb_user_account (wx_openid,created_at_ms,updated_at_ms) VALUES (?,1000,1000)', [openid],
    );
  }
}

module.exports = { checkUnicode };

const assert = require('node:assert/strict');

async function checkColumnMetadata(connection, database) {
  const [columns] = await connection.query(
    "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, NUMERIC_PRECISION AS precisionValue, NUMERIC_SCALE AS scaleValue FROM information_schema.columns WHERE table_schema = ? AND TABLE_NAME = 'cb_session_location' AND COLUMN_NAME IN ('lat','lng')",
    [database],
  );
  assert.deepEqual(columns.map(({ name, precisionValue, scaleValue }) => [name, precisionValue, scaleValue]).sort(),
    [['lat', 10, 7], ['lng', 11, 7]]);
  const [indexes] = await connection.query(
    "SELECT DISTINCT INDEX_NAME AS name FROM information_schema.statistics WHERE TABLE_SCHEMA = ? AND INDEX_NAME IN ('uq_profile_pending_vendor','uq_session_active_vendor','uq_location_active_session') AND NON_UNIQUE = 0",
    [database],
  );
  assert.equal(indexes.length, 3);
  const [textColumns] = await connection.query(
    'SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, COLLATION_NAME AS collation FROM information_schema.columns WHERE table_schema = ?',
    [database],
  );
  const collations = new Map(textColumns.map((column) => [`${column.tableName}.${column.name}`, column.collation]));
  for (const key of [
    'cb_user_account.wx_openid', 'cb_user_account.wx_unionid', 'cb_vendor_identity.vendor_code',
    'cb_admin_permission.permission_code', 'cb_vendor_profile_version.category_code',
    'cb_user_role.status', 'cb_feedback_case.feedback_type', 'cb_idempotency_operation.key_hash',
  ]) assert.equal(collations.get(key), 'utf8mb4_bin', key);
  const [idColumns] = await connection.query(
    "SELECT COLUMN_NAME AS name, DATA_TYPE AS type FROM information_schema.columns WHERE table_schema = ? AND TABLE_NAME = 'cb_user_account' AND COLUMN_NAME IN ('id','created_at_ms')",
    [database],
  );
  assert.deepEqual(idColumns.map(({ name, type }) => [name, type]).sort(),
    [['created_at_ms', 'bigint'], ['id', 'bigint']]);
}

module.exports = { checkColumnMetadata };

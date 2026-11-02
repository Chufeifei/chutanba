/** 角色与权限授权表只由本域写入；读取时显式列字段，避免表结构漂移带出敏感列。 */

async function findRoles(connection, accountId) {
  const [rows] = await connection.execute(
    'SELECT id, role_code, status FROM cb_user_role WHERE account_id = ? ORDER BY role_code',
    [accountId],
  );
  return rows;
}

async function findGrants(connection, accountId) {
  const [rows] = await connection.execute(
    `SELECT id, permission_code, status, scope_type, scope_key
     FROM cb_admin_permission_grant WHERE account_id = ? ORDER BY permission_code`,
    [accountId],
  );
  return rows;
}

async function findActiveRoleCodes(connection, accountId) {
  const [rows] = await connection.execute(
    "SELECT role_code FROM cb_user_role WHERE account_id = ? AND status = 'ACTIVE' ORDER BY role_code",
    [accountId],
  );
  return rows;
}

/** 一期固定 NATIONAL/ALL；其他范围的未来授权不得算作全国能力。 */
async function findActivePermissionCodes(connection, accountId) {
  const [rows] = await connection.execute(
    `SELECT permission_code FROM cb_admin_permission_grant
     WHERE account_id = ? AND status = 'ACTIVE' AND scope_type = 'NATIONAL' AND scope_key = 'ALL'
     ORDER BY permission_code`,
    [accountId],
  );
  return rows;
}

async function insertRole(connection, { accountId, roleCode, nowMs }) {
  await connection.execute(
    `INSERT INTO cb_user_role (account_id, role_code, status, granted_at_ms)
     VALUES (?, ?, 'ACTIVE', ?)`,
    [accountId, roleCode, nowMs],
  );
}

async function reactivateRole(connection, { id, nowMs }) {
  await connection.execute(
    `UPDATE cb_user_role
     SET status = 'ACTIVE', granted_at_ms = ?, revoked_at_ms = NULL, state_version = state_version + 1
     WHERE id = ? AND status = 'REVOKED'`,
    [nowMs, id],
  );
}

async function revokeRole(connection, { id, nowMs }) {
  await connection.execute(
    `UPDATE cb_user_role
     SET status = 'REVOKED', revoked_at_ms = ?, state_version = state_version + 1
     WHERE id = ? AND status = 'ACTIVE'`,
    [nowMs, id],
  );
}

async function insertGrant(connection, { accountId, permissionCode, nowMs }) {
  await connection.execute(
    `INSERT INTO cb_admin_permission_grant
       (account_id, permission_code, scope_type, scope_key, status, granted_by_account_id, granted_at_ms)
     VALUES (?, ?, 'NATIONAL', 'ALL', 'ACTIVE', NULL, ?)`,
    [accountId, permissionCode, nowMs],
  );
}

async function reactivateGrant(connection, { id, nowMs }) {
  await connection.execute(
    `UPDATE cb_admin_permission_grant
     SET status = 'ACTIVE', granted_at_ms = ?, revoked_at_ms = NULL, revoked_by_account_id = NULL,
         state_version = state_version + 1
     WHERE id = ? AND status = 'REVOKED'`,
    [nowMs, id],
  );
}

async function revokeGrant(connection, { id, nowMs }) {
  await connection.execute(
    `UPDATE cb_admin_permission_grant
     SET status = 'REVOKED', revoked_at_ms = ?, state_version = state_version + 1
     WHERE id = ? AND status = 'ACTIVE'`,
    [nowMs, id],
  );
}

async function insertEvent(connection, event) {
  await connection.execute(
    `INSERT INTO cb_admin_authorization_event
       (actor_account_id, target_account_id, event_type, role_code, permission_code,
        scope_type, scope_key, reason, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.actorAccountId, event.targetAccountId, event.eventType, event.roleCode,
      event.permissionCode, event.scopeType, event.scopeKey, event.reason, event.createdAtMs],
  );
}

module.exports = {
  findRoles, findGrants, findActiveRoleCodes, findActivePermissionCodes,
  insertRole, reactivateRole, revokeRole,
  insertGrant, reactivateGrant, revokeGrant, insertEvent,
};

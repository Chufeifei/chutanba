const env = require('../../config/env');
const { nowMs } = require('../../db/clock');
const audit = require('../audit');
const repository = require('./repository');
const mapper = require('./mapper');
const { expectedGrants } = require('./schema');

const DEPLOY_REASON = 'DEPLOY_CONFIG';

function findRow(rows, field, value) {
  return rows.find((row) => row[field] === value) || null;
}

/** 授权事件供审计与排障使用；actor 为空是因为授予来自部署名单而非某个操作者。 */
async function recordChange(connection, { accountId, eventType, detail, occurredAtMs }) {
  await repository.insertEvent(connection, {
    actorAccountId: null,
    targetAccountId: accountId,
    eventType,
    roleCode: detail.roleCode || null,
    permissionCode: detail.permissionCode || null,
    scopeType: detail.scopeType || null,
    scopeKey: detail.scopeKey || null,
    reason: DEPLOY_REASON,
    createdAtMs: occurredAtMs,
  });
  await audit.record(connection, {
    actionCode: eventType,
    actorAccountId: null,
    targetType: 'ACCOUNT',
    targetId: accountId,
    occurredAtMs,
    resultCode: 'SUCCESS',
    reasonSummary: DEPLOY_REASON,
    retentionClass: 'MANAGEMENT',
  });
}

async function syncRoles(connection, { accountId, expected, rows, time }) {
  const activeCodes = new Set(rows.filter((row) => row.status === 'ACTIVE').map((row) => row.role_code));
  for (const roleCode of expected) {
    if (activeCodes.has(roleCode)) continue;
    const existing = findRow(rows, 'role_code', roleCode);
    if (existing) await repository.reactivateRole(connection, { id: existing.id, nowMs: await time() });
    else await repository.insertRole(connection, { accountId, roleCode, nowMs: await time() });
    await recordChange(connection, {
      accountId, eventType: 'ROLE_GRANT', detail: { roleCode }, occurredAtMs: await time(),
    });
  }
  for (const row of rows) {
    if (row.status !== 'ACTIVE' || expected.includes(row.role_code)) continue;
    const occurredAtMs = await time();
    await repository.revokeRole(connection, { id: row.id, nowMs: occurredAtMs });
    await recordChange(connection, {
      accountId, eventType: 'ROLE_REVOKE', detail: { roleCode: row.role_code }, occurredAtMs,
    });
  }
}

async function syncPermissions(connection, { accountId, expected, rows, time }) {
  const activeCodes = new Set(rows.filter((row) => row.status === 'ACTIVE').map((row) => row.permission_code));
  for (const permissionCode of expected) {
    if (activeCodes.has(permissionCode)) continue;
    const existing = findRow(rows, 'permission_code', permissionCode);
    if (existing) await repository.reactivateGrant(connection, { id: existing.id, nowMs: await time() });
    else await repository.insertGrant(connection, { accountId, permissionCode, nowMs: await time() });
    await recordChange(connection, {
      accountId, eventType: 'PERMISSION_GRANT',
      detail: { permissionCode, scopeType: 'NATIONAL', scopeKey: 'ALL' }, occurredAtMs: await time(),
    });
  }
  for (const row of rows) {
    if (row.status !== 'ACTIVE' || expected.includes(row.permission_code)) continue;
    const occurredAtMs = await time();
    await repository.revokeGrant(connection, { id: row.id, nowMs: occurredAtMs });
    await recordChange(connection, {
      accountId, eventType: 'PERMISSION_REVOKE',
      detail: { permissionCode: row.permission_code, scopeType: row.scope_type, scopeKey: row.scope_key },
      occurredAtMs,
    });
  }
}

/**
 * 差异同步部署名单：无变化不写库；只在新增或撤销时写授权事件与管理审计。
 * 事务时间按需读取，纯比对不产生多余时钟查询。
 */
async function syncFromConfig(connection, account, openid) {
  const expected = expectedGrants(env.authorization, openid);
  let occurredAtMs = null;
  const time = async () => {
    if (occurredAtMs === null) occurredAtMs = await nowMs(connection);
    return occurredAtMs;
  };
  const roleRows = await repository.findRoles(connection, account.id);
  const grantRows = await repository.findGrants(connection, account.id);
  await syncRoles(connection, { accountId: account.id, expected: expected.roles, rows: roleRows, time });
  await syncPermissions(connection, {
    accountId: account.id, expected: expected.permissions, rows: grantRows, time,
  });
}

/** 每次请求重新读取，撤销后下一次调用立即失效。 */
async function getCapabilities(connection, accountId) {
  const roles = await repository.findActiveRoleCodes(connection, accountId);
  const permissions = await repository.findActivePermissionCodes(connection, accountId);
  return mapper.toCapabilities(
    roles.map((row) => row.role_code),
    permissions.map((row) => row.permission_code),
  );
}

module.exports = { syncFromConfig, getCapabilities };

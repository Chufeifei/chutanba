/**
 * 管理域：上下文、摊主检索、治理暂停／恢复。
 *
 * 三条不可让步的规则：
 * 1. 每次请求在事务内重新读取当前有效授权，撤销后下一次调用立即失效；
 * 2. 治理动作只由 ADMIN／SUPER_ADMIN 执行，且必须带理由与预期版本；
 * 3. 暂停与结束当前轮次在同一事务、同一主库时刻完成，恢复只清治理列。
 */
const { withTransaction } = require('../../db/transaction');
const { nowMs } = require('../../db/clock');
const { DomainError } = require('../../domain/errors');
const account = require('../account');
const authorization = require('../authorization');
const session = require('../session');
const publication = require('../publication');
const impact = require('../impact');
const operation = require('../operation');
const repository = require('./repository');
const mapper = require('./mapper');
const schema = require('./schema');

const ADMIN_CAPABILITIES = Object.freeze(['ADMIN', 'SUPER_ADMIN']);
const ANY_MANAGEMENT = Object.freeze(['SUPER_ADMIN', 'ADMIN', 'PROFILE_REVIEWER', 'FIELD_REVIEWER']);
const OPERATION_TYPE = Object.freeze({ PAUSE: 'GOVERNANCE_PAUSE', RESTORE: 'GOVERNANCE_RESTORE' });
const ACTION_TYPE = Object.freeze({ PAUSE: 'GOVERNANCE_PAUSE', RESTORE: 'GOVERNANCE_RESTORE' });
const IMPACT_LABEL = Object.freeze({ PAUSE: '治理暂停公开', RESTORE: '解除治理暂停' });

function unwrap(outcome, payload) {
  if (outcome.status === 'PROCESSING') return outcome;
  if (outcome.status === 'FAILED') throw new DomainError(outcome.bizCode);
  return { ...(outcome.replayed ? outcome.result : payload), replayed: outcome.replayed };
}

async function capabilitiesOf(connection, accountId) {
  return authorization.getCapabilities(connection, accountId);
}

/** 写命令的预检：单独一次读事务，真正决定仍在 execute 事务内复核授权。 */
async function loadCapabilities(accountId) {
  return withTransaction((connection) => capabilitiesOf(connection, accountId));
}

async function getContext(identity) {
  const actor = await account.resolveAccount(identity);
  return withTransaction(async (connection) => {
    const capabilities = await capabilitiesOf(connection, actor.id);
    authorization.assertAnyCapability(capabilities, ANY_MANAGEMENT);
    const roles = await repository.findActiveRoleCodes(connection, actor.id);
    const counts = {
      profileReviews: await repository.countPendingProfileReviews(connection),
      fieldFeedback: await repository.countPendingFeedbackCases(connection),
      impactReviews: await repository.countPendingImpactReviews(connection),
    };
    return mapper.toContext({ roles, capabilities, counts });
  });
}

/** 管理搜索只给摘要；不返回顾客身份、历史位置或反馈内容。 */
async function listVendors(identity, query) {
  const actor = await account.resolveAccount(identity);
  const input = schema.parseVendorQuery(query);
  return withTransaction(async (connection) => {
    authorization.assertAnyCapability(await capabilitiesOf(connection, actor.id), ADMIN_CAPABILITIES);
    const rows = await repository.searchVendors(connection, input);
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page.map(mapper.toVendorSummary),
      nextCursor: hasMore && last ? String(last.id) : null,
    };
  });
}

async function getGovernanceContext(identity, vendorId) {
  const actor = await account.resolveAccount(identity);
  const id = schema.assertId(vendorId, 'vendorId');
  return withTransaction(async (connection) => {
    authorization.assertAnyCapability(await capabilitiesOf(connection, actor.id), ADMIN_CAPABILITIES);
    const vendor = await repository.findVendorById(connection, id);
    if (!vendor || vendor.lifecycle_status === 'DELETED') throw new DomainError('RESOURCE_NOT_FOUND');
    const controls = await publication.getControlsInTransaction(connection, Number(vendor.id));
    const currentRow = vendor.current_session_id
      ? await repository.findSession(connection, vendor.current_session_id) : null;
    const occurredAtMs = await nowMs(connection);
    const phase = currentRow
      ? session.deriveSessionPhase({
        nowMs: occurredAtMs,
        startedAtMs: Number(currentRow.started_at_ms),
        plannedEndAtMs: Number(currentRow.planned_end_at_ms),
      })
      : null;
    const eligibility = session.deriveOpenEligibility({
      activeProfileVersionId: vendor.active_profile_version_id,
      controls,
      live: Boolean(currentRow),
    });
    const actions = await repository.findRecentActions(connection, { vendorId: Number(vendor.id), limit: 5 });
    return mapper.toGovernanceContext({
      vendor,
      controls,
      eligibility,
      currentSession: mapper.toCurrentSession(currentRow, phase || { phase: 'RESTING', remainingMs: 0 }),
      actions,
    });
  });
}

async function recordActionInTransaction(connection, input) {
  return repository.insertAction(connection, input);
}

/** 纠错回放用：按目标轮次读取最近一条同类处理记录。 */
async function findActionByTargetInTransaction(connection, { targetSessionId, actionType }) {
  return repository.findLatestActionByTarget(connection, { targetSessionId, actionType });
}

async function executeGovernance(connection, {
  actorId, vendorId, input, operationId,
}) {
  const occurredAtMs = await nowMs(connection);
  // 事务内复核：预检通过后权限可能已被撤销，决定以本事务读到的授权为准。
  authorization.assertAnyCapability(await capabilitiesOf(connection, actorId), ADMIN_CAPABILITIES);
  const applied = await session.applyGovernanceInTransaction(connection, {
    action: input.action,
    vendorId,
    expectedGovernanceVersion: input.expectedGovernanceVersion,
    reason: input.reason,
    actorAccountId: actorId,
    operationId,
  });
  let actionId = null;
  if (applied.changed) {
    actionId = await recordActionInTransaction(connection, {
      actionType: ACTION_TYPE[input.action],
      vendorId: Number(vendorId),
      targetSessionId: applied.endedSessionId === null ? null : Number(applied.endedSessionId),
      sourceCaseId: null,
      reason: input.reason,
      evidenceSummary: null,
      actorAccountId: actorId,
      effectiveAtMs: occurredAtMs,
    });
    await impact.recordInTransaction(connection, {
      vendorId: Number(vendorId),
      sourceType: 'MANAGEMENT_ACTION',
      sourceId: actionId,
      summary: `${IMPACT_LABEL[input.action]}：${input.reason}`,
      createdAtMs: occurredAtMs,
    });
  } else {
    // 目标状态已成立：不重复写处理记录，回放最近一次同类动作，便于页面显示操作凭据。
    const latest = await repository.findLatestAction(connection, {
      vendorId: Number(vendorId), actionType: ACTION_TYPE[input.action],
    });
    actionId = latest ? Number(latest.id) : null;
  }
  return {
    payload: mapper.toGovernanceResult({
      controls: applied.control, endedSessionId: applied.endedSessionId, actionId,
    }),
    resultRef: `gv:${vendorId}:${input.action}`,
  };
}

async function reloadGovernance(resultRef) {
  const match = /^gv:(\d{1,20}):(PAUSE|RESTORE)$/.exec(String(resultRef || ''));
  if (!match) throw new DomainError('STATE_CONFLICT', '治理结果不可用，请重试');
  const vendorId = BigInt(match[1]).toString();
  const action = match[2];
  return withTransaction(async (connection) => {
    const vendor = await repository.findVendorById(connection, vendorId);
    if (!vendor) throw new DomainError('STATE_CONFLICT', '治理结果不可用，请重试');
    const controls = await publication.getControlsInTransaction(connection, Number(vendor.id));
    const latest = await repository.findLatestAction(connection, {
      vendorId: Number(vendor.id), actionType: ACTION_TYPE[action],
    });
    return mapper.toGovernanceResult({
      controls,
      endedSessionId: latest && latest.target_session_id ? String(latest.target_session_id) : null,
      actionId: latest ? Number(latest.id) : null,
    });
  });
}

async function decideGovernance(identity, vendorId, key, body) {
  const actor = await account.resolveAccount(identity);
  const id = schema.assertId(vendorId, 'vendorId');
  const input = schema.parseGovernanceInput(body);
  authorization.assertAnyCapability(await loadCapabilities(actor.id), ADMIN_CAPABILITIES);
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_TYPE[input.action],
    key,
    request: {
      vendorId: id,
      action: input.action,
      reason: input.reason,
      expectedGovernanceVersion: input.expectedGovernanceVersion,
    },
    execute: async (connection, operationId) => {
      const executed = await executeGovernance(connection, {
        actorId: actor.id, vendorId: id, input, operationId,
      });
      payload = executed.payload;
      return { resultRef: executed.resultRef };
    },
    reload: reloadGovernance,
  });
  return unwrap(outcome, payload);
}

module.exports = {
  getContext,
  listVendors,
  getGovernanceContext,
  decideGovernance,
  recordActionInTransaction,
  findActionByTargetInTransaction,
};

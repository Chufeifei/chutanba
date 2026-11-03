/**
 * 当前轮次纠错（契约 §5.4）。
 *
 * 只结束「指定且已核对」的轮次：
 * - 事项必须真的关联过该轮次，否则说明管理员按旧事项误指了同日新开的轮次；
 * - 轮次必须仍是摊主当前指针指向的那一条，已结束的轮次不再重复写终态；
 * - 终态写入复用 session 的唯一结束入口，不产生第二条收摊路径。
 */
const { withTransaction } = require('../../db/transaction');
const { nowMs } = require('../../db/clock');
const { DomainError } = require('../../domain/errors');
const account = require('../account');
const authorization = require('../authorization');
const impact = require('../impact');
const management = require('../management');
const operation = require('../operation');
const session = require('../session');
const repository = require('./repository');
const mapper = require('./mapper');
const schema = require('./schema');

const OPERATION_TYPE = 'SESSION_CORRECTION';
const REF_PREFIX = 'sc';
const CAPABILITY = 'FIELD_REVIEWER';
const ACTION_TYPE = 'SESSION_CORRECTION';

function conflict(currentVersion) {
  return new DomainError('STATE_CONFLICT', '轮次已更新，请刷新后重试', {
    resource: 'session', currentVersion,
  });
}

function assertRelatedToCase(related) {
  if (!related) {
    throw new DomainError('VALIDATION_FAILED', '该事项与本轮次无关，不能据此纠错', {
      fields: [{ field: 'sourceCaseId', reason: 'SESSION_NOT_RELATED' }],
    });
  }
}

async function executeCorrection(connection, {
  actorId, sessionId, input, operationId,
}) {
  const occurredAtMs = await nowMs(connection);
  authorization.assertCapability(
    await authorization.getCapabilities(connection, actorId), CAPABILITY,
  );
  const preview = await repository.findSession(connection, sessionId);
  if (!preview) throw new DomainError('RESOURCE_NOT_FOUND');
  // 锁顺序与营业写命令一致：摊主行 → 轮次行 → 事项行。
  const vendor = await repository.findVendorByIdForUpdate(connection, preview.vendor_id);
  if (!vendor || vendor.lifecycle_status !== 'ACTIVE') throw new DomainError('RESOURCE_NOT_FOUND');
  const sessionRow = await repository.findSessionForUpdate(connection, sessionId);
  if (!sessionRow) throw new DomainError('RESOURCE_NOT_FOUND');
  if (input.expectedSessionVersion !== Number(sessionRow.version)) {
    throw conflict(Number(sessionRow.version));
  }
  if (sessionRow.ended_at_ms !== null) throw new DomainError('ALREADY_PROCESSED', '该轮次已结束');
  if (String(vendor.current_session_id) !== String(sessionId)) throw conflict(Number(sessionRow.version));

  const caseRow = await repository.findCaseForUpdate(connection, input.sourceCaseId);
  if (!caseRow || String(caseRow.vendor_id) !== String(vendor.id)) {
    throw new DomainError('RESOURCE_NOT_FOUND');
  }
  assertRelatedToCase(await repository.findFactForSession(connection, {
    caseId: input.sourceCaseId, sessionId,
  }));

  // 已过计划收摊时刻时按计划时刻落终态，避免把结束时间写到窗口之外。
  const endedAtMs = Math.min(occurredAtMs, Number(sessionRow.planned_end_at_ms));
  await session.endSessionInTransaction(connection, {
    vendor,
    sessionId,
    endedAtMs,
    endReason: 'CORRECTION',
    actorAccountId: actorId,
    operationId,
    occurredAtMs,
  });

  const actionId = await management.recordActionInTransaction(connection, {
    actionType: ACTION_TYPE,
    vendorId: Number(vendor.id),
    targetSessionId: Number(sessionId),
    sourceCaseId: Number(input.sourceCaseId),
    reason: input.reason,
    evidenceSummary: null,
    actorAccountId: actorId,
    effectiveAtMs: occurredAtMs,
  });
  await impact.recordInTransaction(connection, {
    vendorId: Number(vendor.id),
    sourceType: 'MANAGEMENT_ACTION',
    sourceId: actionId,
    summary: `管理核实后结束当前营业轮次：${input.reason}`,
    createdAtMs: occurredAtMs,
  });

  return {
    payload: mapper.toCorrectionResult({ sessionId, endedAtMs, actionId }),
    resultRef: `${REF_PREFIX}:${sessionId}`,
  };
}

async function reloadCorrection(resultRef) {
  const sessionId = String(resultRef || '').startsWith(`${REF_PREFIX}:`)
    ? String(resultRef).slice(REF_PREFIX.length + 1) : null;
  if (!sessionId || !/^\d{1,20}$/.test(sessionId)) {
    throw new DomainError('STATE_CONFLICT', '纠错结果不可用，请重试');
  }
  return withTransaction(async (connection) => {
    const sessionRow = await repository.findSession(connection, sessionId);
    if (!sessionRow || sessionRow.ended_at_ms === null || sessionRow.end_reason !== 'CORRECTION') {
      throw new DomainError('STATE_CONFLICT', '纠错结果不可用，请重试');
    }
    const action = await management.findActionByTargetInTransaction(connection, {
      targetSessionId: Number(sessionId), actionType: ACTION_TYPE,
    });
    if (!action) throw new DomainError('STATE_CONFLICT', '纠错结果不可用，请重试');
    return mapper.toCorrectionResult({
      sessionId,
      endedAtMs: Number(sessionRow.ended_at_ms),
      actionId: Number(action.id),
    });
  });
}

function unwrap(outcome, payload) {
  if (outcome.status === 'PROCESSING') return outcome;
  if (outcome.status === 'FAILED') throw new DomainError(outcome.bizCode);
  return { ...(outcome.replayed ? outcome.result : payload), replayed: outcome.replayed };
}

async function correctSession(identity, sessionId, key, body) {
  const actor = await account.resolveAccount(identity);
  const id = schema.assertId(sessionId, 'sessionId');
  const input = schema.parseCorrection(body);
  authorization.assertCapability(
    await withTransaction((connection) => authorization.getCapabilities(connection, actor.id)),
    CAPABILITY,
  );
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_TYPE,
    key,
    request: { sessionId: id, ...input },
    execute: async (connection, operationId) => {
      const executed = await executeCorrection(connection, {
        actorId: actor.id, sessionId: id, input, operationId,
      });
      payload = executed.payload;
      return { resultRef: executed.resultRef };
    },
    reload: reloadCorrection,
  });
  return unwrap(outcome, payload);
}

module.exports = { correctSession };

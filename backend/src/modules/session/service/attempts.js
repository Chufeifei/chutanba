/**
 * 开摊尝试：只在「确认截止时间、请求定位之前」登记一次意图，不创建任何营业事实。
 * 需求出处：prd R1 —— 尝试失败／取消／时间失效都不写轮次、位置或出摊日。
 */
const { withTransaction } = require('../../../db/transaction');
const { nowMs } = require('../../../db/clock');
const { DomainError } = require('../../../domain/errors');
const account = require('../../account');
const audit = require('../../audit');
const operation = require('../../operation');
const publication = require('../../publication');
const mapper = require('../mapper');
const repository = require('../repository');
const schema = require('../schema');
const time = require('../time');
const {
  conflict, parseRef, unwrap, lockOwnedVendor, assertVendorVersion, assertActiveProfile, assertUnrestricted,
} = require('./guards');

const OPEN_ATTEMPT = 'OPEN_ATTEMPT';
const OPEN_ATTEMPT_FINISH = 'OPEN_ATTEMPT_FINISH';

async function assertNoLiveSession(connection, vendor, nowMsValue) {
  if (vendor.current_session_id === null) return;
  const current = await repository.findSessionById(connection, vendor.current_session_id);
  if (!current || current.ended_at_ms !== null) return;
  // 已过期的轮次留给开摊命令惰性终态化；这里只拦未到期的轮次。
  if (nowMsValue < Number(current.planned_end_at_ms)) throw conflict('session', Number(current.version));
}

async function executeAttempt(connection, { actorId, input, operationId }) {
  const occurredAtMs = await nowMs(connection);
  const vendor = await lockOwnedVendor(connection, actorId);
  assertVendorVersion(vendor, input.expectedVendorVersion);
  assertActiveProfile(vendor);
  assertUnrestricted(await publication.getControlsInTransaction(connection, Number(vendor.id)));
  await assertNoLiveSession(connection, vendor, occurredAtMs);
  time.validatePlannedEnd({ nowMs: occurredAtMs, plannedEndAtMs: input.plannedEndAtMs });

  const attemptId = await repository.insertOpenAttempt(connection, {
    vendorId: Number(vendor.id), plannedEndAtMs: input.plannedEndAtMs, acceptedAtMs: occurredAtMs,
  });
  await audit.record(connection, {
    actionCode: 'OPEN_ATTEMPT_ACCEPTED',
    actorAccountId: actorId,
    targetType: 'OPEN_ATTEMPT',
    targetId: attemptId,
    occurredAtMs,
    resultCode: 'SUCCESS',
    operationId,
    retentionClass: 'GENERAL',
  });
  return {
    payload: { attemptId: String(attemptId), acceptedAtMs: occurredAtMs, status: 'LOCATING' },
    resultRef: `oa:${attemptId}`,
  };
}

async function reloadAttempt(resultRef) {
  const attemptId = parseRef(resultRef, 'oa');
  return withTransaction(async (connection) => {
    const row = await repository.findOpenAttemptById(connection, attemptId);
    if (!row) throw new DomainError('STATE_CONFLICT', '尝试结果不可用，请重试');
    return mapper.toAttempt(row);
  });
}

async function createOpenAttempt(identity, key, body) {
  const actor = await account.resolveAccount(identity);
  const input = schema.normalizeOpenAttempt(body);
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPEN_ATTEMPT,
    key,
    request: input,
    execute: async (connection, operationId) => {
      const executed = await executeAttempt(connection, { actorId: actor.id, input, operationId });
      payload = executed.payload;
      return { resultRef: executed.resultRef };
    },
    reload: reloadAttempt,
  });
  return unwrap(outcome, payload);
}

/** 只有本人处于 LOCATING 的尝试可以被置为失败／取消；SUCCEEDED 只能由开摊事务写入。 */
async function executeFinish(connection, { actorId, attemptId, input, operationId }) {
  const occurredAtMs = await nowMs(connection);
  const vendor = await lockOwnedVendor(connection, actorId);
  const row = await repository.findOpenAttemptById(connection, attemptId, { forUpdate: true });
  if (!row || String(row.vendor_id) !== String(vendor.id)) throw new DomainError('RESOURCE_NOT_FOUND');
  if (row.status === 'SUCCEEDED') throw new DomainError('ALREADY_PROCESSED');
  if (row.status !== 'LOCATING' && row.status !== input.outcome) throw new DomainError('ALREADY_PROCESSED');

  if (row.status === 'LOCATING') {
    await repository.updateAttemptStatus(connection, {
      attemptId, status: input.outcome, sessionId: null, finishedAtMs: occurredAtMs,
    });
    await audit.record(connection, {
      actionCode: 'OPEN_ATTEMPT_FINISHED',
      actorAccountId: actorId,
      targetType: 'OPEN_ATTEMPT',
      targetId: Number(attemptId),
      occurredAtMs,
      resultCode: 'SUCCESS',
      reasonSummary: input.outcome,
      operationId,
      retentionClass: 'GENERAL',
    });
  }
  return {
    payload: mapper.toAttempt({ ...row, status: input.outcome, finished_at_ms: occurredAtMs }),
    resultRef: `oa:${attemptId}`,
  };
}

async function finishOpenAttempt(identity, attemptId, key, body) {
  const actor = await account.resolveAccount(identity);
  const input = schema.normalizeAttemptFinish(body);
  const parsedId = schema.assertPathId(attemptId);
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPEN_ATTEMPT_FINISH,
    key,
    request: { attemptId: parsedId, ...input },
    execute: async (connection, operationId) => {
      const executed = await executeFinish(connection, {
        actorId: actor.id, attemptId: parsedId, input, operationId,
      });
      payload = executed.payload;
      return { resultRef: executed.resultRef };
    },
    reload: reloadAttempt,
  });
  return unwrap(outcome, payload);
}

module.exports = { createOpenAttempt, finishOpenAttempt };

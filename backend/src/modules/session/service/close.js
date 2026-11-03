/**
 * 手动收摊：走共用结束契约，已结束的轮次重试返回同一终态，到期则返回 DEADLINE。
 * 需求出处：prd R5 —— 手动与到期并发只产生一条终态。
 */
const { withTransaction } = require('../../../db/transaction');
const { nowMs } = require('../../../db/clock');
const { DomainError } = require('../../../domain/errors');
const account = require('../../account');
const operation = require('../../operation');
const mapper = require('../mapper');
const repository = require('../repository');
const schema = require('../schema');
const { endSessionInTransaction } = require('./end');
const {
  conflict, parseRef, unwrap, lockOwnedVendor, lockOwnedSession,
} = require('./guards');

const OPERATION_TYPE = 'SESSION_CLOSE';

function payloadOf({ row, endedAtMs, endReason }) {
  return mapper.toClosedSession({ row, endedAtMs, endReason });
}

async function executeClose(connection, { actorId, sessionId, input, operationId }) {
  const occurredAtMs = await nowMs(connection);
  const vendor = await lockOwnedVendor(connection, actorId);
  const session = await lockOwnedSession(connection, { vendorId: Number(vendor.id), sessionId });
  if (session.ended_at_ms !== null) {
    return {
      payload: payloadOf({ row: session, endedAtMs: Number(session.ended_at_ms), endReason: session.end_reason }),
      resultRef: `ss:${sessionId}`,
    };
  }
  if (input.expectedSessionVersion !== Number(session.version)) {
    throw conflict('session', Number(session.version));
  }
  const plannedEndAtMs = Number(session.planned_end_at_ms);
  // 到期的轮次不按手动收摊处理：结束时刻必须是 E，原因必须是 DEADLINE。
  const deadline = occurredAtMs >= plannedEndAtMs;
  const ended = await endSessionInTransaction(connection, {
    vendor,
    sessionId: Number(session.id),
    endedAtMs: deadline ? plannedEndAtMs : occurredAtMs,
    endReason: deadline ? 'DEADLINE' : 'MANUAL',
    actorAccountId: actorId,
    operationId,
    occurredAtMs,
  });
  return {
    payload: payloadOf({ row: ended.row, endedAtMs: ended.endedAtMs, endReason: ended.endReason }),
    resultRef: `ss:${sessionId}`,
  };
}

async function reloadClosed(resultRef) {
  const sessionId = parseRef(resultRef, 'ss');
  return withTransaction(async (connection) => {
    const row = await repository.findSessionById(connection, sessionId);
    if (!row) throw new DomainError('STATE_CONFLICT', '收摊结果不可用，请重试');
    return payloadOf({
      row,
      endedAtMs: row.ended_at_ms === null ? null : Number(row.ended_at_ms),
      endReason: row.end_reason,
    });
  });
}

async function closeSession(identity, sessionId, key, body) {
  const actor = await account.resolveAccount(identity);
  const parsedSessionId = schema.assertPathId(sessionId, 'sessionId');
  const input = schema.normalizeClose(body);
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_TYPE,
    key,
    request: { sessionId: parsedSessionId, ...input },
    execute: async (connection, operationId) => {
      const executed = await executeClose(connection, {
        actorId: actor.id, sessionId: parsedSessionId, input, operationId,
      });
      payload = executed.payload;
      return { resultRef: executed.resultRef };
    },
    reload: reloadClosed,
  });
  return unwrap(outcome, payload);
}

module.exports = { closeSession };

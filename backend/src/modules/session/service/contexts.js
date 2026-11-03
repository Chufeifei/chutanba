/**
 * 一次性定位上下文签发（OPEN / REFRESH）。
 * 需求出处：prd R1 与 doc/MVP/一期技术设计.md §5 —— 越权目标统一 404，
 * 归属与状态校验留在本用例，location-context 只认账号、用途与目标 ID。
 */
const { withTransaction } = require('../../../db/transaction');
const { nowMs } = require('../../../db/clock');
const { DomainError } = require('../../../domain/errors');
const account = require('../../account');
const locationContext = require('../../location-context');
const operation = require('../../operation');
const publication = require('../../publication');
const repository = require('../repository');
const schema = require('../schema');
const time = require('../time');
const {
  conflict, parseRef, unwrap, lockOwnedVendor, assertUnrestricted, lockOwnedSession,
} = require('./guards');

const OPERATION_TYPE = 'LOCATION_CONTEXT_ISSUE';

async function assertOpenTarget(connection, vendor, targetId, occurredAtMs) {
  const attempt = await repository.findOpenAttemptById(connection, targetId, { forUpdate: true });
  if (!attempt || String(attempt.vendor_id) !== String(vendor.id)) throw new DomainError('RESOURCE_NOT_FOUND');
  if (attempt.status !== 'LOCATING') throw new DomainError('ALREADY_PROCESSED');
  time.validatePlannedEnd({ nowMs: occurredAtMs, plannedEndAtMs: Number(attempt.planned_end_at_ms) });
}

async function assertRefreshTarget(connection, vendor, targetId, occurredAtMs) {
  const session = await lockOwnedSession(connection, { vendorId: Number(vendor.id), sessionId: targetId });
  if (session.ended_at_ms !== null) throw conflict('session', Number(session.version));
  if (occurredAtMs >= Number(session.planned_end_at_ms)) throw conflict('session', Number(session.version));
  assertUnrestricted(await publication.getControlsInTransaction(connection, Number(vendor.id)));
}

async function executeIssue(connection, {
  actorId, vendor, input, key,
}) {
  const occurredAtMs = await nowMs(connection);
  if (input.purpose === 'OPEN') {
    await assertOpenTarget(connection, vendor, input.targetId, occurredAtMs);
  } else {
    await assertRefreshTarget(connection, vendor, input.targetId, occurredAtMs);
  }
  const issued = await locationContext.issueInTransaction(connection, {
    accountId: actorId,
    purpose: input.purpose,
    targetId: input.targetId,
    key,
    nowMs: occurredAtMs,
  });
  const { contextRef, ...payload } = issued;
  return { payload, resultRef: contextRef };
}

function reloadIssued({ accountId, purpose, targetId, key }) {
  return async (resultRef) => {
    const contextId = parseRef(resultRef, 'lc');
    return withTransaction((connection) => locationContext.recomputeToken(connection, {
      contextId, accountId, purpose, targetId, key,
    }));
  };
}

async function issueLocationContext(identity, key, body) {
  const actor = await account.resolveAccount(identity);
  const input = schema.normalizeIssueContext(body);
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_TYPE,
    key,
    request: input,
    execute: async (connection) => {
      const vendor = await lockOwnedVendor(connection, actor.id);
      const executed = await executeIssue(connection, {
        actorId: actor.id, vendor, input, key,
      });
      payload = executed.payload;
      return { resultRef: executed.resultRef };
    },
    reload: reloadIssued({ accountId: actor.id, purpose: input.purpose, targetId: input.targetId, key }),
  });
  return unwrap(outcome, payload);
}

module.exports = { issueLocationContext };

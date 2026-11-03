/**
 * 位置刷新：只对本人、未结束、未到期且两类限制都未生效的轮次生效。
 * 需求出处：prd R4 —— 失败不改变最后成功位置，也不增加出摊日。
 */
const { withTransaction } = require('../../../db/transaction');
const { nowMs } = require('../../../db/clock');
const { DomainError } = require('../../../domain/errors');
const account = require('../../account');
const audit = require('../../audit');
const locationContext = require('../../location-context');
const operation = require('../../operation');
const publication = require('../../publication');
const geo = require('../geo');
const mapper = require('../mapper');
const repository = require('../repository');
const schema = require('../schema');
const { endSessionInTransaction } = require('./end');
const {
  conflict, parseRef, unwrap, lockOwnedVendor, lockOwnedSession,
} = require('./guards');

const OPERATION_TYPE = 'SESSION_REFRESH';

/** 到期先按 E 终态化，再按冲突返回；本命令不产生任何位置事实。 */
async function finalizeIfExpired(connection, { vendor, session, actorId, operationId, occurredAtMs }) {
  if (occurredAtMs < Number(session.planned_end_at_ms)) return false;
  await endSessionInTransaction(connection, {
    vendor,
    sessionId: Number(session.id),
    endedAtMs: Number(session.planned_end_at_ms),
    endReason: 'DEADLINE',
    actorAccountId: actorId,
    operationId,
    occurredAtMs,
  });
  return true;
}

function assertRefreshable({ session, input, controls }) {
  const version = Number(session.version);
  if (input.expectedSessionVersion !== version) throw conflict('session', version);
  if (controls.selfStoppedAtMs !== null || controls.governancePausedAtMs !== null) {
    throw conflict('session', version);
  }
}

async function writeNewLocation(connection, { vendor, sessionId, location, occurredAtMs }) {
  const versionNo = await repository.maxLocationVersion(connection, sessionId) + 1;
  await repository.stopOpenLocations(connection, {
    sessionId, stoppedAtMs: occurredAtMs, stopReason: 'REPLACED',
  });
  return repository.insertLocation(connection, {
    sessionId,
    vendorId: Number(vendor.id),
    versionNo,
    location,
    effectiveAtMs: occurredAtMs,
  });
}

async function executeRefresh(connection, { actorId, sessionId, input, operationId }) {
  const occurredAtMs = await nowMs(connection);
  const vendor = await lockOwnedVendor(connection, actorId);
  const session = await lockOwnedSession(connection, { vendorId: Number(vendor.id), sessionId });
  if (session.ended_at_ms !== null) throw conflict('session', Number(session.version));
  const expired = await finalizeIfExpired(connection, {
    vendor, session, actorId, operationId, occurredAtMs,
  });
  if (expired) throw conflict('session', Number(session.version) + 1);

  const controls = await publication.getControlsInTransaction(connection, Number(vendor.id));
  assertRefreshable({ session, input, controls });
  const context = await locationContext.consumeInTransaction(connection, {
    accountId: actorId,
    purpose: 'REFRESH',
    targetId: String(sessionId),
    token: input.locationContextToken,
    nowMs: occurredAtMs,
  });
  const location = geo.normalizeLocation(input.location, {
    nowMs: occurredAtMs, issuedAtMs: context.issuedAtMs,
  });
  const locationVersionId = await writeNewLocation(connection, {
    vendor, sessionId, location, occurredAtMs,
  });
  await repository.bumpSessionVersion(connection, sessionId);
  await repository.bumpVendorState(connection, { vendorId: Number(vendor.id), nowMs: occurredAtMs });
  await audit.record(connection, {
    actionCode: 'SESSION_LOCATION_REFRESHED',
    actorAccountId: actorId,
    targetType: 'SESSION',
    targetId: Number(sessionId),
    occurredAtMs,
    resultCode: 'SUCCESS',
    reasonSummary: 'REPLACED',
    operationId,
    retentionClass: 'GENERAL',
  });
  return {
    payload: mapper.toRefreshedLocation({
      sessionId,
      locationVersionId,
      lastLocatedAtMs: location.locatedAtMs,
      sessionVersion: Number(session.version) + 1,
    }),
    resultRef: `lv:${locationVersionId}`,
  };
}

async function reloadRefresh(resultRef) {
  const locationId = parseRef(resultRef, 'lv');
  return withTransaction(async (connection) => {
    const location = await repository.findLocationById(connection, locationId);
    if (!location) throw new DomainError('STATE_CONFLICT', '刷新结果不可用，请重试');
    const session = await repository.findSessionById(connection, Number(location.session_id));
    return mapper.toRefreshedLocation({
      sessionId: Number(location.session_id),
      locationVersionId: Number(location.id),
      lastLocatedAtMs: Number(location.located_at_ms),
      sessionVersion: session ? Number(session.version) : 0,
    });
  });
}

async function refreshLocation(identity, sessionId, key, body) {
  const actor = await account.resolveAccount(identity);
  const parsedSessionId = schema.assertPathId(sessionId, 'sessionId');
  const input = schema.normalizeRefresh(body);
  const request = { sessionId: parsedSessionId, ...input };
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_TYPE,
    key,
    request,
    execute: async (connection, operationId) => {
      const executed = await executeRefresh(connection, {
        actorId: actor.id, sessionId: parsedSessionId, input, operationId,
      });
      payload = executed.payload;
      return { resultRef: executed.resultRef };
    },
    reload: reloadRefresh,
  });
  return unwrap(outcome, payload);
}

module.exports = { refreshLocation };

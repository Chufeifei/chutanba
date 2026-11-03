/**
 * 开摊：唯一能形成营业事实的入口。
 * 顺序见 doc/MVP/一期技术设计.md §6 —— expectedVendorVersion 必须早于惰性终态化，
 * 因为“自动到期”不是用户并发写入，不应让客户端拿到冲突码。
 */
const { withTransaction } = require('../../../db/transaction');
const { nowMs } = require('../../../db/clock');
const { DomainError } = require('../../../domain/errors');
const { sha256Hex } = require('../../../utils/digest');
const account = require('../../account');
const audit = require('../../audit');
const locationContext = require('../../location-context');
const operation = require('../../operation');
const publication = require('../../publication');
const geo = require('../geo');
const mapper = require('../mapper');
const repository = require('../repository');
const schema = require('../schema');
const time = require('../time');
const { endSessionInTransaction } = require('./end');
const {
  conflict, parseRef, unwrap, lockOwnedVendor, assertVendorVersion, assertActiveProfile, assertUnrestricted,
} = require('./guards');

const OPERATION_TYPE = 'SESSION_OPEN';

/** 已到期的旧轮次先按 E 终态化并停止位置；未到期则视为并发冲突。 */
async function finalizeExpired(connection, { vendor, actorId, operationId, occurredAtMs }) {
  if (vendor.current_session_id === null) return;
  const current = await repository.findSessionById(connection, vendor.current_session_id, { forUpdate: true });
  if (!current || current.ended_at_ms !== null) return;
  const plannedEndAtMs = Number(current.planned_end_at_ms);
  if (occurredAtMs < plannedEndAtMs) throw conflict('session', Number(current.version));
  await endSessionInTransaction(connection, {
    vendor, sessionId: Number(current.id), endedAtMs: plannedEndAtMs,
    endReason: 'DEADLINE', actorAccountId: actorId, operationId, occurredAtMs,
  });
}

async function lockAttemptForOpen(connection, { vendor, input, occurredAtMs }) {
  const attempt = await repository.findOpenAttemptById(connection, input.attemptId, { forUpdate: true });
  // 伪造或他人的 attemptId 统一 404，避免按 ID 枚举。
  if (!attempt || String(attempt.vendor_id) !== String(vendor.id)) throw new DomainError('RESOURCE_NOT_FOUND');
  if (attempt.status !== 'LOCATING') throw new DomainError('ALREADY_PROCESSED');
  if (Number(attempt.planned_end_at_ms) !== input.plannedEndAtMs) {
    throw new DomainError('TIME_INVALID', '结束时间与开摊尝试不一致');
  }
  if (occurredAtMs >= input.plannedEndAtMs) throw new DomainError('TIME_INVALID', '结束时间已过');
  return attempt;
}

/** 轮次、初始位置、当地出摊日、尝试成功、摊主指针与钟点必须在同一事务成立。 */
async function writeFacts(connection, { vendor, input, attempt, location, occurredAtMs }) {
  const vendorId = Number(vendor.id);
  const openDate = time.shanghaiDateKey(occurredAtMs);
  const sessionId = await repository.insertSession(connection, {
    vendorId,
    profileVersionId: Number(vendor.active_profile_version_id),
    startedAtMs: occurredAtMs,
    plannedEndAtMs: input.plannedEndAtMs,
  });
  const locationVersionId = await repository.insertLocation(connection, {
    sessionId, vendorId, versionNo: 1, location, effectiveAtMs: occurredAtMs,
  });
  await repository.insertOpenDay(connection, { vendorId, openDate, sessionId, createdAtMs: occurredAtMs });
  await repository.updateAttemptStatus(connection, {
    attemptId: Number(attempt.id), status: 'SUCCEEDED', sessionId, finishedAtMs: occurredAtMs,
  });
  await repository.updateVendorAfterOpen(connection, {
    vendorId, sessionId, clockMin: time.shanghaiClockMin(input.plannedEndAtMs), nowMs: occurredAtMs,
  });
  return { sessionId, locationVersionId, openDate };
}

async function executeOpen(connection, { actorId, input, operationId }) {
  const occurredAtMs = await nowMs(connection);
  const vendor = await lockOwnedVendor(connection, actorId);
  assertVendorVersion(vendor, input.expectedVendorVersion);
  await finalizeExpired(connection, { vendor, actorId, operationId, occurredAtMs });
  assertActiveProfile(vendor);
  assertUnrestricted(await publication.getControlsInTransaction(connection, Number(vendor.id)));
  const attempt = await lockAttemptForOpen(connection, { vendor, input, occurredAtMs });
  time.validatePlannedEnd({ nowMs: occurredAtMs, plannedEndAtMs: input.plannedEndAtMs });

  const context = await locationContext.consumeInTransaction(connection, {
    accountId: actorId,
    purpose: 'OPEN',
    targetId: String(input.attemptId),
    token: input.locationContextToken,
    nowMs: occurredAtMs,
  });
  const location = geo.normalizeLocation(input.location, {
    nowMs: occurredAtMs, issuedAtMs: context.issuedAtMs,
  });
  const facts = await writeFacts(connection, { vendor, input, attempt, location, occurredAtMs });
  const finalVendor = await repository.findVendorById(connection, Number(vendor.id));
  await audit.record(connection, {
    actionCode: 'SESSION_OPENED',
    actorAccountId: actorId,
    targetType: 'SESSION',
    targetId: facts.sessionId,
    occurredAtMs,
    resultCode: 'SUCCESS',
    operationId,
    retentionClass: 'GENERAL',
  });
  return {
    payload: mapper.toSessionOpened({
      ...facts,
      startedAtMs: occurredAtMs,
      plannedEndAtMs: input.plannedEndAtMs,
      stateVersion: Number(finalVendor.state_version),
    }),
    resultRef: `ss:${facts.sessionId}`,
  };
}

async function reloadSession(resultRef) {
  const sessionId = parseRef(resultRef, 'ss');
  return withTransaction(async (connection) => {
    const row = await repository.findSessionById(connection, sessionId);
    if (!row) throw new DomainError('STATE_CONFLICT', '开摊结果不可用，请重试');
    const vendor = await repository.findVendorById(connection, Number(row.vendor_id));
    const location = await repository.findFirstLocation(connection, sessionId);
    return mapper.toSessionOpened({
      sessionId: Number(row.id),
      startedAtMs: Number(row.started_at_ms),
      plannedEndAtMs: Number(row.planned_end_at_ms),
      locationVersionId: location ? Number(location.id) : 0,
      openDate: time.shanghaiDateKey(Number(row.started_at_ms)),
      stateVersion: Number(vendor.state_version),
    });
  });
}

async function openSession(identity, key, body) {
  const actor = await account.resolveAccount(identity);
  const input = schema.normalizeOpenSession(body);
  // 摘要只用于幂等异体判断，明文令牌不进操作摘要表。
  const request = { ...input, locationContextToken: sha256Hex(input.locationContextToken) };
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_TYPE,
    key,
    request,
    execute: async (connection, operationId) => {
      const executed = await executeOpen(connection, { actorId: actor.id, input, operationId });
      payload = executed.payload;
      return { resultRef: executed.resultRef };
    },
    reload: reloadSession,
  });
  return unwrap(outcome, payload);
}

module.exports = { openSession };

/**
 * 本人停止／恢复公开。
 * 需求出处：prd R6 与 doc/MVP/一期技术设计.md §7.3 —— 停止同事务结束当前轮次；
 * 恢复只清本人列，不清治理列、不恢复旧轮，无生效资料时直接 PROFILE_REQUIRED。
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
const { endCurrentSessionInTransaction } = require('./end');
const { conflict, parseRef, unwrap, lockOwnedVendor } = require('./guards');

const OPERATION_STOP = 'PUBLICATION_STOP';
const OPERATION_RESUME = 'PUBLICATION_RESUME';

async function currentSnapshot(connection, vendorId) {
  const controls = await publication.getControlsInTransaction(connection, vendorId);
  const vendor = await repository.findVendorById(connection, vendorId);
  return mapper.toControlSnapshot(controls, Number(vendor.state_version));
}

async function executeStop(connection, { actorId, input, operationId }) {
  const occurredAtMs = await nowMs(connection);
  const vendor = await lockOwnedVendor(connection, actorId);
  const vendorId = Number(vendor.id);
  const controls = await publication.getControlsInTransaction(connection, vendorId);
  // 重复请求不产生新事件：直接回放当前状态。
  if (controls.selfStoppedAtMs !== null) {
    return {
      payload: mapper.toControlSnapshot(controls, Number(vendor.state_version)),
      resultRef: `pb:${vendorId}`,
    };
  }
  if (input.expectedSelfVersion !== controls.selfVersion) throw conflict('publication', controls.selfVersion);
  const ended = await endCurrentSessionInTransaction(connection, {
    vendor, actorAccountId: actorId, operationId, occurredAtMs, reason: 'SELF_STOP',
  });
  const fresh = await repository.findVendorById(connection, vendorId);
  await publication.setSelfStoppedInTransaction(connection, {
    vendorId,
    vendorStateVersion: Number(fresh.state_version),
    expectedSelfVersion: controls.selfVersion,
    stoppedAtMs: occurredAtMs,
  });
  await repository.bumpVendorState(connection, { vendorId, nowMs: occurredAtMs });
  await audit.record(connection, {
    actionCode: 'PUBLICATION_SELF_STOPPED',
    actorAccountId: actorId,
    targetType: 'VENDOR',
    targetId: vendorId,
    occurredAtMs,
    resultCode: 'SUCCESS',
    operationId,
    retentionClass: 'GENERAL',
  });
  const payload = await currentSnapshot(connection, vendorId);
  if (ended) payload.endedSessionId = String(ended.row.id);
  return { payload, resultRef: `pb:${vendorId}` };
}

async function executeResume(connection, { actorId, input, operationId }) {
  const occurredAtMs = await nowMs(connection);
  const vendor = await lockOwnedVendor(connection, actorId);
  const vendorId = Number(vendor.id);
  const controls = await publication.getControlsInTransaction(connection, vendorId);
  if (input.expectedSelfVersion !== controls.selfVersion) throw conflict('publication', controls.selfVersion);
  // 无生效资料时不清列：资料重新审核通过后本人才能恢复公开。
  if (vendor.active_profile_version_id === null || vendor.active_profile_version_id === undefined) {
    throw new DomainError('PROFILE_REQUIRED');
  }
  if (controls.selfStoppedAtMs === null) {
    return {
      payload: mapper.toControlSnapshot(controls, Number(vendor.state_version)),
      resultRef: `pb:${vendorId}`,
    };
  }
  await publication.setSelfResumedInTransaction(connection, {
    vendorId,
    vendorStateVersion: Number(vendor.state_version),
    expectedSelfVersion: controls.selfVersion,
  });
  await repository.bumpVendorState(connection, { vendorId, nowMs: occurredAtMs });
  await audit.record(connection, {
    actionCode: 'PUBLICATION_SELF_RESUMED',
    actorAccountId: actorId,
    targetType: 'VENDOR',
    targetId: vendorId,
    occurredAtMs,
    resultCode: 'SUCCESS',
    operationId,
    retentionClass: 'GENERAL',
  });
  const payload = await currentSnapshot(connection, vendorId);
  // 恢复不恢复旧轮次，因此资格投影的 live 恒为 false。
  payload.profileEligibility = mapper.toEligibility({
    activeProfileVersionId: vendor.active_profile_version_id,
    controls: await publication.getControlsInTransaction(connection, vendorId),
    live: false,
  });
  return { payload, resultRef: `pb:${vendorId}` };
}

async function reloadPublication(resultRef) {
  const vendorId = parseRef(resultRef, 'pb');
  return withTransaction(async (connection) => {
    const vendor = await repository.findVendorById(connection, vendorId);
    if (!vendor) throw new DomainError('STATE_CONFLICT', '公开状态不可用，请重试');
    return currentSnapshot(connection, Number(vendor.id));
  });
}

async function mutatePublication(identity, key, body, { operationType, execute }) {
  const actor = await account.resolveAccount(identity);
  const input = schema.normalizeSelfMutation(body);
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType,
    key,
    request: input,
    execute: async (connection, operationId) => {
      const executed = await execute(connection, { actorId: actor.id, input, operationId });
      payload = executed.payload;
      return { resultRef: executed.resultRef };
    },
    reload: reloadPublication,
  });
  return unwrap(outcome, payload);
}

function stopSelfPublication(identity, key, body) {
  return mutatePublication(identity, key, body, { operationType: OPERATION_STOP, execute: executeStop });
}

function resumeSelfPublication(identity, key, body) {
  return mutatePublication(identity, key, body, { operationType: OPERATION_RESUME, execute: executeResume });
}

module.exports = { stopSelfPublication, resumeSelfPublication };

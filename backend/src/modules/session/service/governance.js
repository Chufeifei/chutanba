/**
 * 治理暂停／解除（仅服务层）。
 * 需求出处：prd R8 与 doc/MVP/一期技术设计.md §7.4 —— 暂停必须同事务结束当前轮次，
 * 解除只清治理列；管理 HTTP 路由与 ADMIN 权限入口留给 W7，W4 只校验目标摊主与治理版本。
 *
 * 幂等：按 prd R9 的写命令统一约定走 operation.executeIdempotent，
 * 操作键由调用方（W7 的管理路由使用 Idempotency-Key）提供。
 */
const { withTransaction } = require('../../../db/transaction');
const { nowMs } = require('../../../db/clock');
const { DomainError } = require('../../../domain/errors');
const audit = require('../../audit');
const operation = require('../../operation');
const publication = require('../../publication');
const mapper = require('../mapper');
const repository = require('../repository');
const { endCurrentSessionInTransaction } = require('./end');
const {
  conflict, parseRef, unwrap, lockVendorById,
} = require('./guards');

const OPERATION_PAUSE = 'GOVERNANCE_PAUSE';
const OPERATION_RESTORE = 'GOVERNANCE_RESTORE';

function invalid(field) {
  return new DomainError('VALIDATION_FAILED', '治理动作参数不合法', { fields: [{ field, reason: 'INVALID' }] });
}

function assertVendorId(value) {
  const text = String(value === undefined || value === null ? '' : value);
  if (!/^\d{1,20}$/.test(text) || BigInt(text) <= 0n) throw invalid('vendorId');
  return BigInt(text).toString();
}

function assertVersion(value, field) {
  if (!Number.isInteger(value) || value < 1) throw invalid(field);
  return value;
}

function assertActor(value) {
  if (!Number.isInteger(value) || value <= 0) throw invalid('actorAccountId');
  return value;
}

async function snapshotOf(connection, vendorId) {
  const controls = await publication.getControlsInTransaction(connection, vendorId);
  const vendor = await repository.findVendorById(connection, vendorId);
  return mapper.toControlSnapshot(controls, Number(vendor.state_version));
}

async function applyPause(connection, {
  vendorId, expectedGovernanceVersion, reason, actorAccountId, operationId,
}) {
  const occurredAtMs = await nowMs(connection);
  const vendor = await lockVendorById(connection, vendorId);
  const numericId = Number(vendor.id);
  const controls = await publication.getControlsInTransaction(connection, numericId);
  if (controls.governancePausedAtMs !== null) return snapshotOf(connection, numericId);
  if (expectedGovernanceVersion !== controls.governanceVersion) {
    throw conflict('publication', controls.governanceVersion);
  }
  await endCurrentSessionInTransaction(connection, {
    vendor, actorAccountId, operationId, occurredAtMs, reason: 'GOVERNANCE',
  });
  const fresh = await repository.findVendorById(connection, numericId);
  await publication.setGovernancePausedInTransaction(connection, {
    vendorId: numericId,
    vendorStateVersion: Number(fresh.state_version),
    expectedGovernanceVersion: controls.governanceVersion,
    pausedAtMs: occurredAtMs,
  });
  await repository.bumpVendorState(connection, { vendorId: numericId, nowMs: occurredAtMs });
  await audit.record(connection, {
    actionCode: 'PUBLICATION_GOVERNANCE_PAUSED',
    actorAccountId,
    targetType: 'VENDOR',
    targetId: numericId,
    occurredAtMs,
    resultCode: 'SUCCESS',
    reasonSummary: reason || 'GOVERNANCE',
    operationId,
    retentionClass: 'MANAGEMENT',
  });
  return snapshotOf(connection, numericId);
}

async function applyRestore(connection, {
  vendorId, expectedGovernanceVersion, actorAccountId, operationId,
}) {
  const occurredAtMs = await nowMs(connection);
  const vendor = await lockVendorById(connection, vendorId);
  const numericId = Number(vendor.id);
  const controls = await publication.getControlsInTransaction(connection, numericId);
  if (controls.governancePausedAtMs === null) return snapshotOf(connection, numericId);
  if (expectedGovernanceVersion !== controls.governanceVersion) {
    throw conflict('publication', controls.governanceVersion);
  }
  await publication.setGovernanceRestoredInTransaction(connection, {
    vendorId: numericId,
    vendorStateVersion: Number(vendor.state_version),
    expectedGovernanceVersion: controls.governanceVersion,
  });
  await repository.bumpVendorState(connection, { vendorId: numericId, nowMs: occurredAtMs });
  await audit.record(connection, {
    actionCode: 'PUBLICATION_GOVERNANCE_RESTORED',
    actorAccountId,
    targetType: 'VENDOR',
    targetId: numericId,
    occurredAtMs,
    resultCode: 'SUCCESS',
    operationId,
    retentionClass: 'MANAGEMENT',
  });
  return snapshotOf(connection, numericId);
}

async function reloadGovernance(resultRef) {
  const vendorId = parseRef(resultRef, 'pb');
  return withTransaction(async (connection) => {
    const vendor = await repository.findVendorById(connection, vendorId);
    if (!vendor) throw new DomainError('STATE_CONFLICT', '治理状态不可用，请重试');
    return snapshotOf(connection, Number(vendor.id));
  });
}

async function mutate(input, { operationType, execute }) {
  const vendorId = assertVendorId(input.vendorId);
  const expectedGovernanceVersion = assertVersion(
    input.expectedGovernanceVersion, 'expectedGovernanceVersion',
  );
  const actorAccountId = assertActor(input.actorAccountId);
  const reason = input.reason === undefined ? null : input.reason;
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actorAccountId}`,
    operationType,
    key: input.idempotencyKey,
    request: { vendorId, expectedGovernanceVersion, reason },
    execute: async (connection, operationId) => {
      payload = await execute(connection, {
        vendorId, expectedGovernanceVersion, reason, actorAccountId, operationId,
      });
      return { resultRef: `pb:${vendorId}` };
    },
    reload: reloadGovernance,
  });
  return unwrap(outcome, payload);
}

function pauseGovernance(input) {
  return mutate(input, { operationType: OPERATION_PAUSE, execute: applyPause });
}

function resumeGovernance(input) {
  return mutate(input, { operationType: OPERATION_RESTORE, execute: applyRestore });
}

module.exports = { pauseGovernance, resumeGovernance };

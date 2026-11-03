/**
 * 治理暂停／解除的事务内实现（管理域专用）。
 * 需求出处：prd R8 与 doc/MVP/一期技术设计.md §7.4 —— 暂停必须同事务结束当前轮次，
 * 解除只清治理列；权限入口与处理记录由 W7 的管理域负责，本文件只做状态变更。
 *
 * 幂等：由调用方（management 域）统一走 operation.executeIdempotent，
 * 操作键来自 Idempotency-Key；本函数不接受事务外的调用。
 */
const { nowMs } = require('../../../db/clock');
const audit = require('../../audit');
const publication = require('../../publication');
const repository = require('../repository');
const { endCurrentSessionInTransaction } = require('./end');
const { conflict, lockVendorById } = require('./guards');

const ACTIONS = Object.freeze(['PAUSE', 'RESTORE']);

/**
 * @returns {{control: object, endedSessionId: string|null, changed: boolean}}
 *   changed=false 表示目标状态已成立，本次不新增状态变更（幂等重放的基础）。
 */
async function applyGovernanceInTransaction(connection, {
  action, vendorId, expectedGovernanceVersion, reason, actorAccountId, operationId,
}) {
  if (!ACTIONS.includes(action)) throw new TypeError(`未知治理动作：${action}`);
  const occurredAtMs = await nowMs(connection);
  const vendor = await lockVendorById(connection, vendorId);
  const numericId = Number(vendor.id);
  const controls = await publication.getControlsInTransaction(connection, numericId);

  if (action === 'PAUSE') {
    if (controls.governancePausedAtMs !== null) return { control: controls, endedSessionId: null, changed: false };
    if (expectedGovernanceVersion !== controls.governanceVersion) {
      throw conflict('publication', controls.governanceVersion);
    }
    const ended = await endCurrentSessionInTransaction(connection, {
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
      reasonSummary: reason,
      operationId,
      retentionClass: 'MANAGEMENT',
    });
    return {
      control: await publication.getControlsInTransaction(connection, numericId),
      endedSessionId: ended ? String(ended.row.id) : null,
      changed: true,
    };
  }

  if (controls.governancePausedAtMs === null) return { control: controls, endedSessionId: null, changed: false };
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
    reasonSummary: reason,
    operationId,
    retentionClass: 'MANAGEMENT',
  });
  return {
    control: await publication.getControlsInTransaction(connection, numericId),
    endedSessionId: null,
    changed: true,
  };
}

module.exports = { applyGovernanceInTransaction };

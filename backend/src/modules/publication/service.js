/**
 * 公开控制域。
 *
 * 两组列（本人 self_* / 治理 governance_*）各有独立版本，互不覆盖；
 * 事务内方法只接受调用方 connection、不自行开事务，供 session 在同一事务
 * 完成「结束轮次 + 写限制列」。这是本模块唯一的跨域事务协作点，改动前先读
 * doc/MVP/一期技术设计.md §2。
 */
const { withTransaction } = require('../../db/transaction');
const { DomainError } = require('../../domain/errors');
const repository = require('./repository');
const mapper = require('./mapper');

function conflict(currentVersion) {
  return new DomainError('STATE_CONFLICT', '公开状态已更新，请刷新后重试', {
    resource: 'publication',
    currentVersion,
  });
}

async function loadVendorByAccount(connection, accountId) {
  const vendor = await repository.findVendorByAccount(connection, accountId);
  if (!vendor) throw new DomainError('RESOURCE_NOT_FOUND');
  if (vendor.lifecycle_status !== 'ACTIVE') throw new DomainError('NOT_ELIGIBLE');
  return vendor;
}

/** 本人公开控制读模型；无摊主 404，不伪造空工作台。 */
async function getSelf(accountId) {
  return withTransaction(async (connection) => {
    const vendor = await loadVendorByAccount(connection, accountId);
    const row = await repository.findByVendor(connection, Number(vendor.id));
    return mapper.toSelfPublication({ vendor, row });
  });
}

/** 供 GET /me 合并：只返回受限时刻，不改变账号级语义。 */
async function getSelfContext(vendorId) {
  if (!Number.isSafeInteger(vendorId) || vendorId <= 0) return {};
  return withTransaction(async (connection) => {
    const row = await repository.findByVendor(connection, vendorId);
    return mapper.toSelfContext(row);
  });
}

/** 写流程内的资格判断：读控制行，缺省按“未受限”处理。 */
async function getControlsInTransaction(connection, vendorId) {
  return mapper.toControls(await repository.findByVendor(connection, vendorId));
}

function assertExpected(expected, current) {
  if (expected !== current) throw conflict(current);
}

async function mutate(connection, { vendorId, vendorStateVersion, expectedVersion, field, write }) {
  const row = await repository.ensureForUpdate(connection, { vendorId, vendorStateVersion });
  const current = Number(row[field === 'selfVersion' ? 'self_version' : 'governance_version']);
  assertExpected(expectedVersion, current);
  const changed = await write({ controlId: row.id, current });
  // 行锁已串行化同摊主写入，affectedRows 为 0 只可能是版本被外部改动。
  if (changed === 0) throw conflict(current + 1);
  return { version: current + 1 };
}

async function setSelfStoppedInTransaction(connection, { vendorId, vendorStateVersion, expectedSelfVersion, stoppedAtMs }) {
  return mutate(connection, {
    vendorId,
    vendorStateVersion,
    expectedVersion: expectedSelfVersion,
    field: 'selfVersion',
    write: ({ controlId, current }) => repository.updateSelfStopped(connection, {
      controlId, expectedSelfVersion: current, stoppedAtMs,
    }),
  });
}

async function setSelfResumedInTransaction(connection, { vendorId, vendorStateVersion, expectedSelfVersion }) {
  return mutate(connection, {
    vendorId,
    vendorStateVersion,
    expectedVersion: expectedSelfVersion,
    field: 'selfVersion',
    write: ({ controlId, current }) => repository.updateSelfResumed(connection, {
      controlId, expectedSelfVersion: current,
    }),
  });
}

async function setGovernancePausedInTransaction(connection, {
  vendorId, vendorStateVersion, expectedGovernanceVersion, pausedAtMs,
}) {
  return mutate(connection, {
    vendorId,
    vendorStateVersion,
    expectedVersion: expectedGovernanceVersion,
    field: 'governanceVersion',
    write: ({ controlId, current }) => repository.updateGovernancePaused(connection, {
      controlId, expectedGovernanceVersion: current, pausedAtMs,
    }),
  });
}

async function setGovernanceRestoredInTransaction(connection, {
  vendorId, vendorStateVersion, expectedGovernanceVersion,
}) {
  return mutate(connection, {
    vendorId,
    vendorStateVersion,
    expectedVersion: expectedGovernanceVersion,
    field: 'governanceVersion',
    write: ({ controlId, current }) => repository.updateGovernanceRestored(connection, {
      controlId, expectedGovernanceVersion: current,
    }),
  });
}

module.exports = {
  getSelf,
  getSelfContext,
  getControlsInTransaction,
  setSelfStoppedInTransaction,
  setSelfResumedInTransaction,
  setGovernancePausedInTransaction,
  setGovernanceRestoredInTransaction,
};

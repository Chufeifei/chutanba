/**
 * 营业写命令的共用前置判断：摊主解析、资格、版本冲突、轮次归属。
 * 需求出处：prd R3/R9 与 doc/MVP/一期技术设计.md §9（锁顺序与冲突码）。
 */
const { DomainError } = require('../../../domain/errors');
const repository = require('../repository');

/** STATE_CONFLICT 的 data 只给调用者有权读取的资源与当前版本号。 */
function conflict(resource, currentVersion) {
  const data = currentVersion === undefined ? { resource } : { resource, currentVersion };
  return new DomainError('STATE_CONFLICT', '状态已更新，请刷新后重试', data);
}

/** 幂等结果引用固定为 <prefix>:<id>；格式异常按结果未知处理，不猜测业务事实。 */
function parseRef(resultRef, prefix) {
  const match = new RegExp(`^${prefix}:(\\d+)$`).exec(resultRef || '');
  if (!match) throw new DomainError('STATE_CONFLICT', '操作结果不可用，请重试');
  return match[1];
}

/** 写命令统一入口：先锁账号行再锁摊主行，同摊主的所有写命令串行在摊主行锁上。 */
async function lockOwnedVendor(connection, accountId) {
  await repository.lockAccount(connection, accountId);
  const vendor = await repository.findVendorByAccount(connection, accountId, { forUpdate: true });
  if (!vendor) throw new DomainError('RESOURCE_NOT_FOUND');
  if (vendor.lifecycle_status !== 'ACTIVE') throw new DomainError('NOT_ELIGIBLE');
  return vendor;
}

/** 治理动作由管理侧发起，没有本人身份，只能按摊主 ID 加锁。 */
async function lockVendorById(connection, vendorId) {
  const vendor = await repository.findVendorById(connection, vendorId, { forUpdate: true });
  if (!vendor) throw new DomainError('RESOURCE_NOT_FOUND');
  if (vendor.lifecycle_status !== 'ACTIVE') throw new DomainError('NOT_ELIGIBLE');
  return vendor;
}

function assertVendorVersion(vendor, expectedVendorVersion) {
  const current = Number(vendor.state_version);
  if (expectedVendorVersion !== current) throw conflict('vendor', current);
}

function assertActiveProfile(vendor) {
  if (vendor.active_profile_version_id === null || vendor.active_profile_version_id === undefined) {
    throw new DomainError('NOT_ELIGIBLE', '缺少可公开的生效资料');
  }
}

/** 两类公开限制只要有一列成立，就不允许开摊、刷新或恢复公开。 */
function assertUnrestricted(controls) {
  if (controls.selfStoppedAtMs !== null) throw new DomainError('NOT_ELIGIBLE', '本人已停止公开');
  if (controls.governancePausedAtMs !== null) throw new DomainError('NOT_ELIGIBLE', '当前处于治理暂停');
}

async function lockOwnedSession(connection, { vendorId, sessionId, forUpdate = true }) {
  const session = await repository.findSessionById(connection, sessionId, { forUpdate });
  // 他人轮次与不存在统一 404，避免按 ID 枚举他人营业记录。
  if (!session || String(session.vendor_id) !== String(vendorId)) throw new DomainError('RESOURCE_NOT_FOUND');
  return session;
}

/** 幂等结果统一收口：PROCESSING／FAILED 原样返回，首次执行与回放都带 replayed 标记。 */
function unwrap(outcome, payload) {
  if (outcome.status === 'PROCESSING') return outcome;
  if (outcome.status === 'FAILED') throw new DomainError(outcome.bizCode);
  return { ...(outcome.replayed ? outcome.result : payload), replayed: outcome.replayed };
}

module.exports = {
  unwrap,
  conflict,
  parseRef,
  lockOwnedVendor,
  lockVendorById,
  assertVendorVersion,
  assertActiveProfile,
  assertUnrestricted,
  lockOwnedSession,
};

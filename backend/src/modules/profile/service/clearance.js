/**
 * 资料清除（清除域调用）。
 *
 * 两件事必须分开：
 * - 「停止公开」属于公开控制域，由 session/publication 处理；
 * - 「资料不可读」属于资料域：清生效指针 + 冻结相交待审申请 + 去标识化历史内容。
 *
 * 只提供事务内入口：清除域在自己的事务里调用，保证与清除请求同生共死。
 */
const repository = require('../repository');

/** 清除请求成立时调用：冻结待审申请并清空生效资料指针。 */
async function clearPublicProfileInTransaction(connection, { vendorId, nowMs }) {
  const invalidatedVersions = await repository.invalidatePendingVersions(connection, {
    vendorId, decidedAtMs: nowMs,
  });
  await repository.clearActiveProfileVersion(connection, { vendorId, nowMs });
  return { invalidatedVersions };
}

/** 待审申请数量：预览要说明清除会冻结几份待审资料。 */
async function countPendingVersionsInTransaction(connection, { vendorId }) {
  return repository.countPendingVersions(connection, { vendorId });
}

/**
 * 清理批次调用：把可清除的完整值换成墓碑值，保留版本行与审核痕迹。
 * 重复执行不会重复改写（已是墓碑值的行不再动）。
 */
async function deidentifyProfileContentInTransaction(connection, { vendorId, tombstone }) {
  return repository.deidentifyVersions(connection, {
    vendorId,
    vendorName: tombstone.vendorName,
    categoryCode: tombstone.categoryCode,
  });
}

module.exports = {
  clearPublicProfileInTransaction, deidentifyProfileContentInTransaction, countPendingVersionsInTransaction,
};

/**
 * 位置版本的清除相关读模型与去标识化。
 *
 * 位置行归营业域所有：清除域不得直接改 cb_session_location，
 * 只能通过这两个事务内方法读取位置清单与执行去标识化。
 */
const repository = require('../repository');

/** 摊主行：清除域要锁它并读取生效资料指针与当前轮次指针。 */
async function findVendorInTransaction(connection, { vendorId }) {
  return repository.findVendorById(connection, vendorId);
}

/** 账号绑定的活跃摊主：清除域据此判断「是否留下无主摊主」。 */
async function findVendorByAccountInTransaction(connection, { accountId }) {
  return repository.findVendorByAccount(connection, accountId);
}

/** 锁摊主行：清除请求要串行化同摊主的公开与资料变更。 */
async function lockVendorInTransaction(connection, { vendorId }) {
  return repository.findVendorById(connection, vendorId, { forUpdate: true });
}

/** 轮次行：清除预览要说明当前轮次是否会被结束。 */
async function findSessionInTransaction(connection, { sessionId }) {
  return repository.findSessionById(connection, sessionId);
}

/** 摊主的全部位置版本：清除预览与保留期计算按各自停止时刻逐版本处理。 */
async function listVendorLocationsInTransaction(connection, { vendorId }) {
  return repository.listVendorLocations(connection, { vendorId });
}

/** 去标识化坐标：重复执行不重复改写，保留最小墓碑行；只处理清单内的位置版本。 */
async function deidentifyVendorLocationsInTransaction(connection, {
  vendorId, locationName, locationIds,
}) {
  return repository.deidentifyVendorLocations(connection, { vendorId, locationName, locationIds });
}

module.exports = {
  listVendorLocationsInTransaction,
  deidentifyVendorLocationsInTransaction,
  findVendorInTransaction,
  findVendorByAccountInTransaction,
  lockVendorInTransaction,
  findSessionInTransaction,
};

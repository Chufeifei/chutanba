const { createOpenAttempt, finishOpenAttempt } = require('./attempts');
const { issueLocationContext } = require('./contexts');
const { openSession } = require('./open');
const { refreshLocation } = require('./refresh');
const { closeSession } = require('./close');
const { stopSelfPublication, resumeSelfPublication, applySelfStopInTransaction } = require('./publication');
const { applyGovernanceInTransaction } = require('./governance');
const { getWorkbench } = require('./workbench');
const { listOpenDays } = require('./open-days');
const {
  listVendorLocationsInTransaction,
  deidentifyVendorLocationsInTransaction,
  findVendorInTransaction,
  findVendorByAccountInTransaction,
  lockVendorInTransaction,
  findSessionInTransaction,
} = require('./clearance');

module.exports = {
  createOpenAttempt,
  finishOpenAttempt,
  issueLocationContext,
  openSession,
  refreshLocation,
  closeSession,
  stopSelfPublication,
  resumeSelfPublication,
  // 本人停止公开的事务内入口：清除请求成立时复用同一段「结束轮次 + 写停止列」逻辑。
  applySelfStopInTransaction,
  // 治理状态变更只提供事务内入口：权限、处理记录与幂等由管理域（W7）持有。
  applyGovernanceInTransaction,
  getWorkbench,
  listOpenDays,
  // 位置清单、摊主行读取与去标识化只提供事务内入口：清除域（W8）持有事务与保留期判断。
  listVendorLocationsInTransaction,
  deidentifyVendorLocationsInTransaction,
  findVendorInTransaction,
  findVendorByAccountInTransaction,
  lockVendorInTransaction,
  findSessionInTransaction,
};

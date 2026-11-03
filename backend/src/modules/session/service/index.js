const { createOpenAttempt, finishOpenAttempt } = require('./attempts');
const { issueLocationContext } = require('./contexts');
const { openSession } = require('./open');
const { refreshLocation } = require('./refresh');
const { closeSession } = require('./close');
const { stopSelfPublication, resumeSelfPublication } = require('./publication');
const { applyGovernanceInTransaction } = require('./governance');
const { getWorkbench } = require('./workbench');
const { listOpenDays } = require('./open-days');

module.exports = {
  createOpenAttempt,
  finishOpenAttempt,
  issueLocationContext,
  openSession,
  refreshLocation,
  closeSession,
  stopSelfPublication,
  resumeSelfPublication,
  // 治理状态变更只提供事务内入口：权限、处理记录与幂等由管理域（W7）持有。
  applyGovernanceInTransaction,
  getWorkbench,
  listOpenDays,
};

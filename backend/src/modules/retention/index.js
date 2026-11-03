/**
 * 保留期域对外出口。
 *
 * 期限算期是纯函数，挂起登记与关闭只提供事务内方法：
 * 调用方（反馈、反馈复核、影响复核、清除）在自己已经打开的事务里登记挂起，
 * 避免保留域反向开事务或替别人的业务下判断。
 */
const {
  RETENTION_DAYS,
  TARGET_TYPE,
  SOURCE_TYPE,
  computeDueAtMs,
  locationEvidenceDueAtMs,
  generalEvidenceDueAtMs,
  managementAuditDueAtMs,
  caseExtensionDueAtMs,
  clearRequestDueAtMs,
  latestDueAtMs,
  openHoldInTransaction,
  closeHoldsInTransaction,
  resolveLocationRetentionsInTransaction,
  listOpenHoldsInTransaction,
} = require('./service');

module.exports = {
  RETENTION_DAYS,
  TARGET_TYPE,
  SOURCE_TYPE,
  computeDueAtMs,
  locationEvidenceDueAtMs,
  generalEvidenceDueAtMs,
  managementAuditDueAtMs,
  caseExtensionDueAtMs,
  clearRequestDueAtMs,
  latestDueAtMs,
  openHoldInTransaction,
  closeHoldsInTransaction,
  resolveLocationRetentionsInTransaction,
  listOpenHoldsInTransaction,
};

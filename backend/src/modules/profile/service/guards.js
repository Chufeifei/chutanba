const { withTransaction } = require('../../../db/transaction');
const { DomainError } = require('../../../domain/errors');
const authorization = require('../../authorization');

/** STATE_CONFLICT 的 data 只给调用者有权读取的资源与当前版本号。 */
function conflict(resource, currentVersion) {
  const data = currentVersion === undefined ? { resource } : { resource, currentVersion };
  return new DomainError('STATE_CONFLICT', '状态已更新，请刷新后重试', data);
}

/** 幂等结果引用固定为 <prefix>:<id>，格式异常按结果未知处理，不猜测业务事实。 */
function parseRef(resultRef, prefix) {
  const match = new RegExp(`^${prefix}:(\\d+)$`).exec(resultRef || '');
  if (!match) throw new DomainError('STATE_CONFLICT', '操作结果不可用，请重试');
  return Number(match[1]);
}

/** 入口级权限判断；service 只接收普通对象，不依赖路由或客户端声明。 */
async function loadCapabilities(accountId) {
  return withTransaction((connection) => authorization.getCapabilities(connection, accountId));
}

function assertReviewer(capabilities) {
  if (!capabilities.includes('PROFILE_REVIEWER')) throw new DomainError('PERMISSION_DENIED');
}

module.exports = { conflict, parseRef, loadCapabilities, assertReviewer };

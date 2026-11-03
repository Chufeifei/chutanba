/**
 * 本人身份编排（P03 / P09 / P14 共用）。
 *
 * 唯一职责：拿最新 /me、整形、写回 store，并让订阅页面自动更新。
 * 页面不要自己调 api/me —— 否则"我的"和工作台可能拿着两份不同的资格。
 */
const { getMe } = require('../../api/me');
const identityStore = require('../../store/identity');
const { toIdentitySnapshot, describeProfileState } = require('./mapper');

/**
 * 刷新本人快照。
 * @param {object} [options]
 * @param {boolean} [options.silent] 为真时失败不清空已有快照（后台复核失败不应让页面变空）
 * @returns {Promise<object|null>} 归一化后的快照
 */
async function refreshIdentity({ silent = false } = {}) {
  try {
    const response = await getMe();
    const snapshot = toIdentitySnapshot(response && response.data);
    identityStore.setSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    // 账号暂不可识别不是致命错误：公开浏览仍要继续可用（需求第 2 节）
    if (!silent) identityStore.setSnapshot(null);
    throw error;
  }
}

/** 读取当前快照：先给已有值，页面再决定是否 refresh。 */
function getIdentity() {
  return identityStore.getSnapshot();
}

function clearIdentity() {
  identityStore.clearSnapshot();
}

module.exports = {
  refreshIdentity,
  getIdentity,
  clearIdentity,
  describeProfileState,
};

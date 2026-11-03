/**
 * 本人身份与能力（跨页共享态）。
 *
 * 为什么放 store：P03 的入口、P09 的工作台资格、P14 的管理入口都读同一份本人快照。
 * 如果各页面自己调 /me，就会出现"我的页面显示是摊主、工作台说没资格"这类漂移。
 *
 * 约束：
 * - 只存纯数据，不存页面实例；
 * - 不在这里发网络请求（请求由 services/account 发起，结果写回这里）；
 * - 能力位只用于决定"要不要显示入口"，绝不作为权限判断 —— 服务端每次都会重新鉴权。
 */
const { CAPABILITY } = require('../config/contracts');

let snapshot = null;
const listeners = new Set();

function getSnapshot() {
  return snapshot;
}

function setSnapshot(next) {
  snapshot = next || null;
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      // 单个订阅者异常不应中断其他页面的刷新
      console.error('identity subscriber failed', error);
    }
  });
  return snapshot;
}

function clearSnapshot() {
  setSnapshot(null);
}

/** 页面在 onLoad 订阅、onUnload 取消，必须成对出现。 */
function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 能力位查询；快照未就绪时一律 false，避免闪现受限入口。 */
function hasCapability(code) {
  if (!snapshot || !Array.isArray(snapshot.capabilities)) return false;
  return snapshot.capabilities.includes(code);
}

function hasAnyCapability(codes) {
  return Array.isArray(codes) && codes.some((code) => hasCapability(code));
}

/** 是否已具备摊主开摊资格（有生效资料且未被两类限制挡住）。 */
function isVendorEligible() {
  return Boolean(snapshot) && snapshot.profileEligible === true;
}

/** 账号是否可识别；不可识别时公开浏览仍可用，本人写入会提示重新登录。 */
function isIdentified() {
  return Boolean(snapshot) && Boolean(snapshot.accountId);
}

module.exports = {
  CAPABILITY,
  getSnapshot,
  setSnapshot,
  clearSnapshot,
  subscribe,
  hasCapability,
  hasAnyCapability,
  isVendorEligible,
  isIdentified,
};

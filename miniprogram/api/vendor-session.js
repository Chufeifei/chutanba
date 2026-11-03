/**
 * 营业轮次与位置接口（契约 §5.2）。
 *
 * 一条硬规则：开摊必须"先记尝试意图 → 取定位上下文 → 定位成功 → 才提交开摊"。
 * 定位失败或取消时调 finishOpenAttempt 记为失败，不形成轮次、位置和出摊日。
 * 这样试点统计才能区分"想开没开成"和"根本没试"。
 */
const { get } = require('../utils/request');
const { VENDOR } = require('../config/endpoints');
const { writePost } = require('./core-v2');

/** 工作台快照：资格、两类限制、轮次、阶段、剩余、最后成功位置。 */
function getWorkbench() {
  return get(VENDOR.WORKBENCH);
}

/** 用户确认截止时间后、请求定位前，先记一次开摊意图。 */
function createOpenAttempt({ plannedEndAtMs, expectedVendorVersion } = {}, options) {
  return writePost(VENDOR.OPEN_ATTEMPTS, { plannedEndAtMs, expectedVendorVersion }, options);
}

/** 定位失败 / 时间失效 / 主动取消时收尾；成功只能由开摊事务标记。 */
function finishOpenAttempt(attemptId, { outcome } = {}, options) {
  return writePost(VENDOR.OPEN_ATTEMPT_FINISH(attemptId), { outcome }, options);
}

/** 定位成功后提交开摊：服务端同一事务写轮次、首个位置、当地出摊日。 */
function openSession({
  attemptId,
  plannedEndAtMs,
  locationContextToken,
  location,
  expectedVendorVersion,
} = {}, options) {
  return writePost(VENDOR.SESSIONS_OPEN, {
    attemptId,
    plannedEndAtMs,
    locationContextToken,
    location,
    expectedVendorVersion,
  }, options);
}

/** 营业中刷新位置：成功才替换当前导航地址，失败保留上次成功位置。 */
function addSessionLocation(sessionId, { locationContextToken, location, expectedSessionVersion } = {}, options) {
  return writePost(VENDOR.SESSION_LOCATIONS(sessionId), {
    locationContextToken,
    location,
    expectedSessionVersion,
  }, options);
}

/** 手动收摊。到期、本人停止、治理暂停走各自的命令，不在这里。 */
function closeSession(sessionId, { expectedSessionVersion } = {}, options) {
  return writePost(VENDOR.SESSION_CLOSE(sessionId), { expectedSessionVersion }, options);
}

/** 出摊日记录：累计天数与按日摘要，不含历史坐标。 */
function listOpenDays({ cursor, limit } = {}) {
  return get(VENDOR.OPEN_DAYS, { cursor, limit });
}

module.exports = {
  getWorkbench,
  createOpenAttempt,
  finishOpenAttempt,
  openSession,
  addSessionLocation,
  closeSession,
  listOpenDays,
};

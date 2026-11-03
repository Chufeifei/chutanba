/**
 * 观察域对外出口：领取、候选与反馈前置读取。
 * 其他模块只能经此引用，不得直接 require 本域的 repository / mapper / schema。
 */
const {
  claimObservation,
  listCandidates,
  assertFeedbackContextTarget,
  loadForFeedback,
} = require('./service');
const { eligibleUntilMs } = require('./eligibility');

module.exports = {
  claimObservation,
  listCandidates,
  assertFeedbackContextTarget,
  loadForFeedback,
  // 窗口终点的唯一计算入口：反馈域展示与回放都要用同一份口径。
  eligibleUntilMs,
};

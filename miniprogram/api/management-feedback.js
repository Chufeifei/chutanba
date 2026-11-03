/**
 * 管理端现场反馈复核与当前纠错（契约 §5.4）。
 *
 * 两个动作必须分开，这是 P16 的核心：
 * 1. 核实历史事实 —— 只对原轮次的原事实给结论，绝不影响当前营业；
 * 2. 纠正当前轮次 —— 必须显式指定当前 sessionId 与版本，另写一次命令。
 * 所以这里没有"核实并顺便收摊"的合并接口。
 */
const { get } = require('../utils/request');
const { MANAGEMENT } = require('../config/endpoints');
const { writePost } = require('./core-v2');

function listFieldFeedbackCases({ status, cursor, limit } = {}) {
  return get(MANAGEMENT.FIELD_FEEDBACK, { status, cursor, limit });
}

function getFieldFeedbackCase(caseId) {
  return get(MANAGEMENT.FIELD_FEEDBACK_DETAIL(caseId));
}

/**
 * 对事项作出终态结论。
 * factResults 必须覆盖该事项当时的所有事实；任一条确认则事项为 CONFIRMED。
 */
function decideFieldFeedbackCase(caseId, { factResults, expectedTaskVersion } = {}, options) {
  return writePost(MANAGEMENT.FIELD_FEEDBACK_DECISION(caseId), {
    factResults,
    expectedTaskVersion,
  }, options);
}

/** 关闭指定的当前轮次（endReason=CORRECTION）。必须另带当前异常依据。 */
function correctCurrentSession(sessionId, { sourceCaseId, action, reason, expectedSessionVersion } = {}, options) {
  return writePost(MANAGEMENT.SESSION_CORRECTIONS(sessionId), {
    sourceCaseId,
    action,
    reason,
    expectedSessionVersion,
  }, options);
}

module.exports = {
  listFieldFeedbackCases,
  getFieldFeedbackCase,
  decideFieldFeedbackCase,
  correctCurrentSession,
};

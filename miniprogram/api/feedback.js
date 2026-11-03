/**
 * 现场反馈接口（契约 §5.3）。
 *
 * 一期的反馈是"线索"，不是处罚：提交只形成待处理事项，由人工复核。
 * 因此这里没有照片、没有一般内容举报、也不允许客户端自填事件时间 ——
 * 事件时刻、原轮次、原位置版本全部由服务端从观察记录读取。
 */
const { get } = require('../utils/request');
const { ME } = require('../config/endpoints');
const { writePost } = require('./core-v2');

/** 匿名浏览时拿到的 claimToken 绑定到本人，之后才能提交反馈。 */
function claimObservation({ claimToken } = {}, options) {
  return writePost(ME.OBSERVATION_CLAIM, { claimToken }, options);
}

/** 本人仍可受理的候选轮次；窗口结束即从列表消失。 */
function listFeedbackCandidates({ cursor, limit } = {}) {
  return get(ME.FEEDBACK_CANDIDATES, { cursor, limit });
}

/**
 * 提交现场反馈。
 * 必须带 observationId 与 locationContextToken，服务端据此核对
 * 5 分钟定位时效与 300 米距离；不接受 sessionId 覆盖。
 */
function submitFieldFeedback({
  observationId,
  type,
  description,
  locationContextToken,
  location,
  expectedObservationVersion,
} = {}, options) {
  return writePost(ME.FIELD_FEEDBACK, {
    observationId,
    type,
    description,
    locationContextToken,
    location,
    expectedObservationVersion,
  }, options);
}

function listMyFeedback({ cursor, limit } = {}) {
  return get(ME.FIELD_FEEDBACK, { cursor, limit });
}

function getMyFeedback(feedbackId) {
  return get(ME.FIELD_FEEDBACK_DETAIL(feedbackId));
}

module.exports = {
  claimObservation,
  listFeedbackCandidates,
  submitFieldFeedback,
  listMyFeedback,
  getMyFeedback,
};

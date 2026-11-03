/**
 * P02 摊主详情的业务编排。
 *
 * 详情页只读；唯一的写动作是"进入现场反馈"时建立观察事实。
 * 观察记录的是"此刻在这个轮次/这个位置看到了什么"，因此必须带
 * 展示时的 sessionId + locationVersionId —— 用页面当前值，不再重取详情。
 */
const publicApi = require('../../api/public');
const { runWrite } = require('../submission');
const { toDetailModel } = require('./mapper');

// 与后端 discovery/observation.js 的 OPERATION_TYPE 一致，超时后按原键查询
const OBSERVATION_OPERATION = 'PUBLIC_OBSERVATION';

/**
 * 读取公开详情。
 * @param {string} vendorId
 * @returns {Promise<object>} 详情视图模型（OPEN / RESTING / UNVIEWABLE）
 */
async function loadDetail(vendorId) {
  const response = await publicApi.getPublicVendorDetail(String(vendorId));
  return toDetailModel(response && response.data, Date.now());
}

/**
 * 建立"我正在看这个摊位"的观察事实，供后续现场反馈引用。
 * 不在这里跳转或提示 —— 页面按 outcome 决定。
 * @param {object} params
 * @param {string} params.vendorId
 * @param {string} params.sessionId
 * @param {string} params.locationVersionId
 * @returns {Promise<{outcome: string, data?: object, message?: string}>}
 */
async function createFeedbackObservation({ vendorId, sessionId, locationVersionId }) {
  return runWrite({
    operationType: OBSERVATION_OPERATION,
    execute: ({ idempotencyKey }) => publicApi.createObservation(
      String(vendorId),
      { source: 'DETAIL', sessionId, locationVersionId },
      { idempotencyKey },
    ),
  });
}

module.exports = {
  OBSERVATION_OPERATION,
  loadDetail,
  createFeedbackObservation,
};

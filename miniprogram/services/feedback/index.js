/**
 * 反馈读取编排（P04 / P06 共用）。
 *
 * 读接口本身不需要幂等键；唯一的写动作是"把匿名观察绑定到本人"，
 * 它必须走 submission，否则超时后会重复绑定。
 *
 * 注意列表响应形状：两个列表接口返回的是 { rows, nextCursor }，不是 items。
 */
const feedbackApi = require('../../api/feedback');
const { runWrite } = require('../submission');
const mapper = require('./mapper');
const submitService = require('./submit');

const DEFAULT_PAGE_SIZE = 20;

// 与后端 modules/observation/service.js 的操作类型一致
const CLAIM_OPERATION = 'OBSERVATION_CLAIM';

/** 列表接口统一返回 rows；结构异常时抛错，不要静默降级成"没有记录"。 */
function readRows(response) {
  const data = (response && response.data) || {};
  if (!Array.isArray(data.rows)) {
    throw new TypeError('反馈列表响应结构异常：data.rows 应为数组');
  }
  return { rows: data.rows, nextCursor: data.nextCursor || '' };
}

/**
 * 可反馈的轮次。窗口结束后服务端不再返回，因此这里不做二次过滤。
 * @returns {Promise<Array<object>>}
 */
async function loadCandidates() {
  const response = await feedbackApi.listFeedbackCandidates({ limit: DEFAULT_PAGE_SIZE });
  const { rows } = readRows(response);
  const nowMs = Date.now();
  return rows.map((item) => mapper.toCandidateModel(item, nowMs));
}

/**
 * 本人已提交的反馈记录。
 * @param {object} [params]
 * @param {string} [params.cursor]
 * @returns {Promise<{records: Array<object>, nextCursor: string}>}
 */
async function loadMyRecords({ cursor } = {}) {
  const response = await feedbackApi.listMyFeedback({ cursor, limit: DEFAULT_PAGE_SIZE });
  const { rows, nextCursor } = readRows(response);
  const nowMs = Date.now();
  return { records: rows.map((item) => mapper.toRecordModel(item, nowMs)), nextCursor };
}

/** 单条反馈的本人可见结果（含事件摘要与问题类型，P06 需要认出是哪一次）。 */
async function loadRecordDetail(feedbackId) {
  const response = await feedbackApi.getMyFeedback(String(feedbackId));
  const data = (response && response.data) || {};
  return mapper.toResultModel({
    status: data.status,
    reason: data.resultReason,
    submittedAtMs: data.submittedAtMs,
    vendorName: (data.vendorSummary && data.vendorSummary.vendorName) || '摊主',
    typeLabel: mapper.typeLabelOf(data.type),
    eventAtMs: Number(data.eventAtMs) || 0,
  }, Date.now());
}

/**
 * 提交前的准备：绑定匿名观察 → 在候选里定位这条观察 → 给出可选的问题类型。
 *
 * 为什么要在候选里找一遍：提交接口必须带 expectedObservationVersion，
 * 而"建立观察"的响应不带版本；候选列表是唯一同时给出窗口、版本与已提交类型的地方。
 * @param {object} params
 * @param {string} params.observationId
 * @param {string} [params.claimToken] 匿名浏览时一次性带过来的领取令牌
 * @returns {Promise<{candidate: object, typeOptions: Array<object>}|null>} null 表示已不可提交
 */
async function prepareSubmission({ observationId, claimToken }) {
  if (claimToken) {
    // 已被领取（CONFLICT）说明本来就是本人观察，不阻断后续流程
    await claimObservation(claimToken).catch(() => null);
  }
  const candidates = await loadCandidates();
  const candidate = candidates.find((item) => item.observationId === String(observationId));
  if (!candidate) return null;
  return {
    candidate,
    typeOptions: mapper.TYPE_OPTIONS.map((option) => ({
      ...option,
      // 已提交过的类型不再可选，避免必然失败的重复提交
      disabled: candidate.submittedTypes.indexOf(option.value) >= 0,
    })),
  };
}

/**
 * 把匿名浏览时建立的观察绑定到当前身份。
 * @param {string} claimToken 详情页建观察时一次性带过来的令牌
 * @returns {Promise<{outcome: string, data?: object, message?: string}>}
 */
async function claimObservation(claimToken) {
  return runWrite({
    operationType: CLAIM_OPERATION,
    execute: ({ idempotencyKey }) => feedbackApi.claimObservation(
      { claimToken },
      { idempotencyKey },
    ),
  });
}

module.exports = {
  CLAIM_OPERATION,
  TYPE_OPTIONS: mapper.TYPE_OPTIONS,
  loadCandidates,
  loadMyRecords,
  loadRecordDetail,
  prepareSubmission,
  claimObservation,
  toResultModel: mapper.toResultModel,
  // 页面只依赖域入口，不直接 require submit.js
  submitFeedback: submitService.submitFeedback,
  querySubmitOutcome: submitService.querySubmitOutcome,
};

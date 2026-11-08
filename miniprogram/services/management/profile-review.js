/**
 * 管理分包资料审核编排（屏 14）。
 *
 * 两条链路：读取审核任务详情、提交审核决定。
 * 决定所需的版本基准只取详情响应里的 taskVersion，不由页面推断。
 * 写操作统一经 services/submission.runWrite 注入 Idempotency-Key；
 * 收到 202 仍在途时按原键查询结果，不重新提交、不换键。
 */
const profileApi = require('../../api/management-profile');
const { ApiError, ERROR_CATEGORY } = require('../../utils/failure');
const { runWrite, queryOutcome } = require('../submission');
const {
  DECISION_OPERATION,
  PROCESSING_MARK,
  tipOf,
  toDecisionView,
  toQueryView,
} = require('./common');

/** 把详情响应裁成页面字段；版本与标识原样保留，供决定提交使用。 */
function toDetailModel(detail) {
  const history = Array.isArray(detail.reviewHistory) ? detail.reviewHistory : [];
  return {
    reviewId: String(detail.submissionId || ''),
    taskVersion: detail.taskVersion,
    applicant: detail.vendorName || '—',
    submittedAtText: formatTime(detail.submittedAtMs),
    contentText: [
      detail.categoryCode,
      detail.regularItemsText,
      detail.priceDescription,
      detail.announcement,
    ].filter(Boolean).join(' / ') || '—',
    historyText: history.length
      ? history.map((item) => (item.decision === 'APPROVE' ? '通过' : '驳回')).join('、')
      : '暂无',
  };
}

function formatTime(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const d = new Date(value);
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 未带标识时，从待审队列取第一条作为详情标识；失败交给上层统一换算提示。 */
async function resolveReviewId(reviewId) {
  if (reviewId) return String(reviewId);
  const response = await profileApi.listProfileReviews({ status: 'PENDING', limit: '1' });
  const rows = (response && response.data && response.data.rows) || [];
  return rows.length ? String(rows[0].submissionId) : '';
}

/**
 * 读取详情。ok=false 时 tip 为极短提示；empty=true 表示当前没有待审任务。
 * @returns {Promise<{ok:boolean, empty?:boolean, model?:object, tip?:string}>}
 */
async function loadReviewDetail(reviewId) {
  try {
    const id = await resolveReviewId(reviewId);
    if (!id) return { ok: true, empty: true };
    const response = await profileApi.getProfileReview(id);
    return { ok: true, model: toDetailModel((response && response.data) || {}) };
  } catch (error) {
    return { ok: false, tip: tipOf(error) };
  }
}

/**
 * 提交通过或驳回。版本基准来自 loadReviewDetail 的 model.taskVersion。
 * execute 内识别 202 在途：抛可保留原键的错误，使 runWrite 不清除键，
 * 页面随后按原键调用 queryDecisionOutcome 直到出结果。
 */
function submitDecision({ reviewId, decision, reason, expectedTaskVersion }) {
  const payload = { decision, reason, expectedTaskVersion };
  return runWrite({
    operationType: DECISION_OPERATION,
    execute: async ({ idempotencyKey }) => {
      const response = await profileApi.decideProfileReview(reviewId, payload, { idempotencyKey });
      const data = response && response.data;
      if (data && data.status === 'PROCESSING') {
        throw new ApiError({
          message: PROCESSING_MARK,
          category: ERROR_CATEGORY.RETRYABLE,
          maybeDelivered: true,
          bizCode: PROCESSING_MARK,
        });
      }
      return response;
    },
  }).then(toDecisionView);
}

/** 按原键查询上一次决定结果，供页面轮询。 */
function queryDecisionOutcome() {
  return queryOutcome({ operationType: DECISION_OPERATION }).then(toQueryView);
}

module.exports = {
  loadReviewDetail,
  submitDecision,
  queryDecisionOutcome,
};

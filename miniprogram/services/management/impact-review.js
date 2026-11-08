/**
 * 管理分包影响复核编排（屏 18）。
 *
 * 两条链路：影响复核任务详情读取、复核决定提交。
 * 决定所需的版本基准 taskVersion 只取 GET 详情响应，不由页面推断或写死。
 * 写命令统一经 services/submission.runWrite 注入 Idempotency-Key；
 * 收到 202 仍在途时按原键查询结果，不重新提交、不换键。
 * 读、写两侧遇到 PERMISSION_DENIED / RESOURCE_NOT_FOUND 只回极短提示，
 * 错误码与规则说明一律不上屏。
 */
const impactApi = require('../../api/management-impact');
const { IMPACT_REVIEW_STATUS_LABEL, IMPACT_SOURCE_LABEL } = require('../../config/contracts');
const { ApiError, ERROR_CATEGORY } = require('../../utils/failure');
const { runWrite, queryOutcome } = require('../submission');
const {
  PROCESSING_MARK,
  tipOf,
  toDecisionView,
  toQueryView,
} = require('./common');

// 与后端 modules/impact/service/review/decision.js 的 OPERATION_DECISION 一致。
// 结果查询按类型精确匹配，提交与查询共用同一个类型，否则按原键查不到本次意图。
const IMPACT_DECISION_OPERATION = 'IMPACT_REVIEW_DECISION';

// 复核结论取自后端白名单（schema.REVIEW_DECISIONS），页面不自由填写。
const IMPACT_DECISION = Object.freeze({ UPHELD: 'UPHELD', REVOKED: 'REVOKED' });

// 页面可见文案统一在此收口，均为状态、字段、动作与极短提示。
const IMPACT_TIP = Object.freeze({
  LOADING: '正在加载',
  EMPTY: '暂无待处理任务',
  PROCESSING: '正在处理，请稍候',
  FAIL: '暂时未能完成',
});

/** 毫秒时间戳转短文本；无值给占位符，不推算。 */
function timeText(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const date = new Date(value);
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 详情响应裁成页面字段。
 * taskVersion 原样取自 GET 详情，供决定按钮绑定与提交，页面不推断、不写死。
 */
function toDetailModel(detail) {
  return {
    reviewId: String(detail.impactReviewId || ''),
    taskVersion: detail.taskVersion,
    statusText: IMPACT_REVIEW_STATUS_LABEL[detail.status] || '—',
    applicant: detail.vendorName || detail.vendorCode || '—',
    submittedAtText: timeText(detail.submittedAtMs),
    subjectText: detail.statement ? String(detail.statement) : '—',
    sourceText: IMPACT_SOURCE_LABEL[detail.impactSourceType] || '—',
    impactText: detail.impactSummary ? String(detail.impactSummary) : '—',
    recordText: detail.decisionReason
      ? `${detail.decisionReason} · ${timeText(detail.decidedAtMs)}`
      : '暂无',
  };
}

/** 未带标识时，从待处理队列取第一条作为详情标识；失败交给上层统一换算提示。 */
async function resolveReviewId(reviewId) {
  if (reviewId) return String(reviewId);
  const response = await impactApi.listImpactReviews({ status: 'PENDING', limit: '1' });
  const rows = (response && response.data && response.data.rows) || [];
  return rows.length ? String(rows[0].impactReviewId) : '';
}

/**
 * 链路一：读取详情。ok=false 时 tip 为极短提示；empty=true 表示当前没有待处理任务。
 * @returns {Promise<{ok:boolean, empty?:boolean, model?:object, tip?:string}>}
 */
async function loadImpactReviewDetail(reviewId) {
  try {
    const id = await resolveReviewId(reviewId);
    if (!id) return { ok: true, empty: true };
    const response = await impactApi.getImpactReviewReview(id);
    return { ok: true, model: toDetailModel((response && response.data) || {}) };
  } catch (error) {
    return { ok: false, tip: tipOf(error) };
  }
}

/**
 * 链路二：提交复核决定。expectedTaskVersion 来自 loadImpactReviewDetail 的 GET 详情。
 * execute 内识别 202 在途：转成结果未知让 runWrite 保留原键，页面随后按原键
 * 反复调用 queryImpactReviewOutcome 轮询，全程不重发、不换键。
 */
function submitImpactReviewDecision({ reviewId, decision, reason, expectedTaskVersion }) {
  const version = Number(expectedTaskVersion);
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (decision !== IMPACT_DECISION.UPHELD && decision !== IMPACT_DECISION.REVOKED) {
    return Promise.resolve({ kind: 'failed', message: IMPACT_TIP.FAIL });
  }
  if (!Number.isSafeInteger(version) || version < 0) {
    return Promise.resolve({ kind: 'failed', message: '状态已变化，请重新进入' });
  }
  if (!text) return Promise.resolve({ kind: 'failed', message: '请填写处理原因' });
  return runWrite({
    operationType: IMPACT_DECISION_OPERATION,
    execute: async ({ idempotencyKey }) => {
      const response = await impactApi.decideImpactReview(
        String(reviewId),
        { decision, reason: text, expectedTaskVersion: version },
        { idempotencyKey },
      );
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

/** 按原键查询一次，供页面轮询或手动查看结果，不再发起写命令。 */
function queryImpactReviewOutcome() {
  return queryOutcome({ operationType: IMPACT_DECISION_OPERATION }).then(toQueryView);
}

module.exports = {
  IMPACT_DECISION,
  IMPACT_DECISION_OPERATION,
  IMPACT_TIP,
  loadImpactReviewDetail,
  submitImpactReviewDecision,
  queryImpactReviewOutcome,
};

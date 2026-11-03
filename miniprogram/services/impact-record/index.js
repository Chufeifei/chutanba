/**
 * 处理记录与人工复核域入口（P13）。
 *
 * 页面只 require 本文件。
 *
 * 读模型要两路数据：影响记录本身 + 我的复核记录。
 * 后者决定"这条记录是否已有未结复核"，因此必须先读复核再装配记录，
 * 否则同一条影响会同时出现"申请复核"按钮和"待人工复核"提示。
 */
const api = require('../../api/impact');
const { OPERATION_TYPE } = require('../../config/contracts');
const { WRITE_OUTCOME } = require('../../utils/failure');
const { runWrite, queryOutcome, QUERY_OUTCOME } = require('../submission');
const mapper = require('./mapper');
const copy = require('./copy');
const validate = require('./validate');

/**
 * 读处理记录与我的复核记录。
 * @param {object} [options]
 * @param {string} [options.cursor] 上一页的 nextCursor
 * @param {object} [options.previous] 已有的记录读模型，传入则追加
 */
async function loadImpacts({ cursor = '', previous = null } = {}) {
  const reviewResponse = await api.listImpactReviews({});
  const reviews = mapper.toReviewsModel((reviewResponse && reviewResponse.data) || {});
  const pendingImpactIds = mapper.pendingImpactIdsOf(reviews.reviews);

  const recordResponse = await api.listImpactRecords({ cursor: cursor || undefined });
  const page = mapper.toRecordsModel((recordResponse && recordResponse.data) || {}, {
    nowMs: Date.now(),
    pendingImpactIds,
  });

  return {
    records: previous ? mapper.appendRecords(previous, page) : page,
    reviews,
  };
}

/**
 * 申请人工复核。
 * 前端先校验说明，省一次必然失败的往返；服务端仍会独立校验。
 */
function submitReview({ impactRecordId, impactVersion, reason }) {
  const checked = validate.validateReason(reason);
  if (!checked.ok) {
    return Promise.resolve({
      outcome: WRITE_OUTCOME.INVALID,
      message: checked.error,
      fields: [{ field: 'reason', reason: 'INVALID' }],
    });
  }
  return runWrite({
    operationType: OPERATION_TYPE.IMPACT_REVIEW_REQUEST,
    execute: ({ idempotencyKey }) => api.createImpactReview(
      {
        impactRecordId,
        reason: checked.value,
        expectedImpactVersion: impactVersion,
      },
      { idempotencyKey },
    ),
  });
}

async function queryAction() {
  const result = await queryOutcome({ operationType: OPERATION_TYPE.IMPACT_REVIEW_REQUEST });
  if (result.outcome === QUERY_OUTCOME.SUCCEEDED) return { kind: 'succeeded', data: result.data };
  if (result.outcome === QUERY_OUTCOME.FAILED || result.outcome === QUERY_OUTCOME.NO_PENDING) {
    return { kind: 'failed', data: result.data };
  }
  return { kind: 'processing' };
}

/**
 * 写结果解读。INVALID 是唯一要把错误显示在输入框下方的情况：
 * 其他类型都显示在页面级的提示区，混在一起会让用户以为要改文案。
 */
function toOutcomeView(result) {
  const outcome = result && result.outcome;
  if (outcome === WRITE_OUTCOME.SUCCEEDED) {
    return {
      kind: 'succeeded',
      message: copy.TIP.SUBMITTED,
      reload: true,
      unknownVisible: false,
      formError: '',
    };
  }
  if (outcome === WRITE_OUTCOME.UNKNOWN) {
    return {
      kind: 'unknown',
      message: '网络中断，尚不确定复核申请是否成立，请先查看最新结果。',
      reload: false,
      unknownVisible: true,
      formError: '',
    };
  }
  if (outcome === WRITE_OUTCOME.INVALID) {
    return {
      kind: 'invalid',
      message: '',
      reload: false,
      unknownVisible: false,
      formError: (result && result.message) || '请检查填写内容',
    };
  }
  const text = copy.submitFailureText(result && result.bizCode)
    || (result && result.message)
    || '提交未能完成';
  if (outcome === WRITE_OUTCOME.CONFLICT) {
    return { kind: 'conflict', message: text, reload: true, unknownVisible: true, formError: '' };
  }
  return { kind: 'failed', message: text, reload: false, unknownVisible: false, formError: '' };
}

module.exports = {
  TIP: copy.TIP,
  STATEMENT_MAX: validate.IMPACT_REVIEW_STATEMENT_MAX,
  loadImpacts,
  submitReview,
  queryAction,
  toOutcomeView,
  submitFailureText: copy.submitFailureText,
};

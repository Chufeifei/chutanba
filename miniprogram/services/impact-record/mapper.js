/**
 * 影响记录与复核记录读模型（P13）。
 *
 * 「能不能申请复核」由这里算好，页面只绑 reviewable 布尔值 ——
 * 否则 wxml 里出现 status === 'ACTIVE' 或时间戳比较，等于把业务判断搬进模板。
 *
 * 三种不可复核原因分别给文案：已撤销 / 已超期 / 已有未结申请。
 */
const { formatMoment } = require('../../utils/formatter');
const {
  IMPACT_STATUS,
  IMPACT_STATUS_LABEL,
  IMPACT_SOURCE_LABEL,
  IMPACT_REVIEW_STATUS,
  IMPACT_REVIEW_STATUS_LABEL,
} = require('../../config/contracts');

function unavailableText({ isActive, expired, hasPendingReview }) {
  if (!isActive) return '该影响已撤销，无需申请复核';
  if (expired) return '已超过可申请复核的期限';
  if (hasPendingReview) return '已有待人工复核的申请';
  return '';
}

/**
 * @param {object} row GET /me/impact-records 的 rows[i]
 * @param {object} context
 * @param {number} context.nowMs 判定期限用的当前时刻
 * @param {Set<string>} context.pendingImpactIds 已有未结复核的影响记录 ID
 */
function toRecordItem(row, context) {
  const source = row || {};
  const nowMs = Number(context && context.nowMs) || Date.now();
  const pendingImpactIds = (context && context.pendingImpactIds) || new Set();
  const status = source.status || IMPACT_STATUS.ACTIVE;
  const isActive = status === IMPACT_STATUS.ACTIVE;
  const reviewableUntilMs = Number(source.reviewableUntilMs);
  const expired = Number.isFinite(reviewableUntilMs) && reviewableUntilMs > 0
    ? nowMs > reviewableUntilMs
    : false;
  const impactRecordId = source.impactRecordId ? String(source.impactRecordId) : '';
  const hasPendingReview = pendingImpactIds.has(impactRecordId);
  const reviewable = isActive && !expired && !hasPendingReview;

  return {
    impactRecordId,
    impactVersion: Number(source.impactVersion) || 0,
    sourceLabel: source.sourceLabel || IMPACT_SOURCE_LABEL[source.sourceType] || '处理措施',
    summary: source.summary ? String(source.summary) : '',
    statusLabel: IMPACT_STATUS_LABEL[status] || '生效中',
    isActive,
    createdText: formatMoment(source.createdAtMs),
    reviewableText: Number.isFinite(reviewableUntilMs) && reviewableUntilMs > 0
      ? formatMoment(reviewableUntilMs) : '',
    reviewable,
    unavailableText: unavailableText({ isActive, expired, hasPendingReview }),
  };
}

function toReviewItem(row) {
  const source = row || {};
  const status = source.status || IMPACT_REVIEW_STATUS.PENDING;
  const decidedAtMs = source.decidedAtMs === null || source.decidedAtMs === undefined
    ? null : Number(source.decidedAtMs);
  return {
    impactReviewId: source.impactReviewId ? String(source.impactReviewId) : '',
    impactRecordId: source.impactRecordId ? String(source.impactRecordId) : '',
    statement: source.statement ? String(source.statement) : '',
    statusLabel: IMPACT_REVIEW_STATUS_LABEL[status] || '待人工复核',
    isPending: status === IMPACT_REVIEW_STATUS.PENDING,
    submittedText: formatMoment(source.submittedAtMs),
    decisionReason: source.decisionReason ? String(source.decisionReason) : '',
    hasDecisionReason: Boolean(source.decisionReason),
    decidedText: decidedAtMs ? formatMoment(decidedAtMs) : '',
    hasDecided: decidedAtMs !== null,
  };
}

/** 从复核列表里挑出未结的那些，用于标记影响记录"已有待复核"。 */
function pendingImpactIdsOf(reviews) {
  const ids = new Set();
  (Array.isArray(reviews) ? reviews : []).forEach((item) => {
    if (item && item.isPending && item.impactRecordId) ids.add(item.impactRecordId);
  });
  return ids;
}

function toRecordsModel(raw, context) {
  const source = raw || {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  return {
    records: rows.map((row) => toRecordItem(row, context)),
    hasRecords: rows.length > 0,
    nextCursor: source.nextCursor ? String(source.nextCursor) : '',
  };
}

function toReviewsModel(raw) {
  const source = raw || {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  return {
    reviews: rows.map(toReviewItem),
    hasReviews: rows.length > 0,
  };
}

function appendRecords(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  return {
    ...next,
    records: previous.records.concat(next.records),
    hasRecords: previous.records.length + next.records.length > 0,
  };
}

module.exports = {
  toRecordItem,
  toReviewItem,
  toRecordsModel,
  toReviewsModel,
  pendingImpactIdsOf,
  appendRecords,
};

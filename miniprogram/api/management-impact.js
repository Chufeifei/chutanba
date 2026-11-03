/**
 * 管理端资料争议与影响复核（契约 §5.4）。
 *
 * 复核结论不删除原反馈事实，只变更影响状态并另留可追踪事件；
 * 它也不自动解除治理暂停或本人停止公开（AC-19）。
 */
const { get } = require('../utils/request');
const { MANAGEMENT } = require('../config/endpoints');
const { writePost } = require('./core-v2');

function listImpactReviews({ status, cursor, limit } = {}) {
  return get(MANAGEMENT.IMPACT_REVIEWS, { status, cursor, limit });
}

function getImpactReviewReview(reviewId) {
  return get(MANAGEMENT.IMPACT_REVIEW_DETAIL(reviewId));
}

function decideImpactReview(reviewId, { decision, reason, expectedTaskVersion } = {}, options) {
  return writePost(MANAGEMENT.IMPACT_REVIEW_DECISION(reviewId), {
    decision,
    reason,
    expectedTaskVersion,
  }, options);
}

module.exports = { listImpactReviews, getImpactReviewReview, decideImpactReview };

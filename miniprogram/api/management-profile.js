/**
 * 管理端资料审核（契约 §5.4）。
 *
 * 审核是"版本切换"，不是"就地修改"：
 * 通过时原子切换生效指针，驳回时只写决定与原因，原生效资料继续使用（AC-12）。
 * 列表只给摘要，详情才取必要受限内容并留读取审计。
 */
const { get } = require('../utils/request');
const { MANAGEMENT } = require('../config/endpoints');
const { writePost } = require('./core-v2');

function listProfileReviews({ status, cursor, limit } = {}) {
  return get(MANAGEMENT.PROFILE_REVIEWS, { status, cursor, limit });
}

function getProfileReview(reviewId) {
  return get(MANAGEMENT.PROFILE_REVIEW_DETAIL(reviewId));
}

/**
 * 通过或驳回。
 * @param {object} params decision=APPROVE/REJECT，REJECT 时 reason 必填
 * @param {object} params expectedTaskVersion 用于并发保护：别人已处理时返回 STATE_CONFLICT
 */
function decideProfileReview(reviewId, { decision, reason, expectedTaskVersion } = {}, options) {
  return writePost(MANAGEMENT.PROFILE_REVIEW_DECISION(reviewId), {
    decision,
    reason,
    expectedTaskVersion,
  }, options);
}

module.exports = { listProfileReviews, getProfileReview, decideProfileReview };

/**
 * 本人影响记录与人工复核（契约 §5.3）。
 *
 * 摊主能看到"对本人产生影响的处理结果"并申请复核，
 * 但看不到反馈人身份、顾客坐标或内部证据 —— 这是服务端投影决定的，客户端不要试图补字段。
 * 申请复核不会自动解除治理暂停或本人停止公开。
 */
const { get } = require('../utils/request');
const { ME } = require('../config/endpoints');
const { writePost } = require('./core-v2');

function listImpactRecords({ cursor, limit } = {}) {
  return get(ME.IMPACT_RECORDS, { cursor, limit });
}

function createImpactReview({ impactRecordId, reason, expectedImpactVersion } = {}, options) {
  return writePost(ME.IMPACT_REVIEWS, { impactRecordId, reason, expectedImpactVersion }, options);
}

function getImpactReview(reviewId) {
  return get(ME.IMPACT_REVIEW_DETAIL(reviewId));
}

module.exports = { listImpactRecords, createImpactReview, getImpactReview };

/**
 * 影响记录域对外出口。
 *
 * 影响记录与影响复核同属一域（同一批表与同一套规则）：
 * 写入只提供事务内入口，读取提供本人列表与管理复核端点。
 * 其他模块不得直接引用本域的 repository / mapper / schema。
 */
const {
  recordInTransaction,
  listMyImpacts,
  findImpactIdBySource,
  countRecordsByVendorInTransaction,
  IMPACT_REVIEW_WINDOW_MS,
  submitReview,
  listMyReviews,
  getMyReview,
  listManagementReviews,
  getManagementReview,
  decideReview,
  countOpenReviewsByVendorInTransaction,
} = require('./service');

module.exports = {
  recordInTransaction,
  listMyImpacts,
  findImpactIdBySource,
  countRecordsByVendorInTransaction,
  IMPACT_REVIEW_WINDOW_MS,
  submitReview,
  listMyReviews,
  getMyReview,
  listManagementReviews,
  getManagementReview,
  decideReview,
  countOpenReviewsByVendorInTransaction,
};

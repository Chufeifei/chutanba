/**
 * 影响复核用例汇总：本人申请、管理决定与两侧读模型。
 * 拆分只为守住单文件 250 行上限，对外出口不变。
 */
const { submitReview } = require('./request');
const { decideReview } = require('./decision');
const {
  listMyReviews, getMyReview, listManagementReviews, getManagementReview,
  countOpenReviewsByVendorInTransaction,
} = require('./read');

module.exports = {
  submitReview,
  decideReview,
  listMyReviews,
  getMyReview,
  listManagementReviews,
  getManagementReview,
  countOpenReviewsByVendorInTransaction,
};

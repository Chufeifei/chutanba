const { submit } = require('./submit');
const { decide } = require('./decide');
const { getSelfProfile, getOwnSubmission, getSelfContext, listReviews, getReview } = require('./read');
const { clearPublicProfileInTransaction, deidentifyProfileContentInTransaction, countPendingVersionsInTransaction } = require('./clearance');

module.exports = {
  submit,
  decide,
  getSelfProfile,
  getOwnSubmission,
  getSelfContext,
  listReviews,
  getReview,
  // 资料清除只提供事务内入口：清除域持有事务与幂等。
  clearPublicProfileInTransaction,
  deidentifyProfileContentInTransaction,
  countPendingVersionsInTransaction,
};

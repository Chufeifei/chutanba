const { submit } = require('./submit');
const { decide } = require('./decide');
const { getSelfProfile, getOwnSubmission, getSelfContext, listReviews, getReview } = require('./read');

module.exports = { submit, decide, getSelfProfile, getOwnSubmission, getSelfContext, listReviews, getReview };

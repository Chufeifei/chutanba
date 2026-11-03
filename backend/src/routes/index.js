const express = require('express');

const me = require('./v2/me');
const profile = require('./v2/profile');
const profileReviews = require('./v2/profile-reviews');
const vendorSessions = require('./v2/vendor-sessions');
const vendorPublication = require('./v2/vendor-publication');
const publicVendors = require('./v2/public-vendors');
const observations = require('./v2/observations');
const fieldFeedback = require('./v2/field-feedback');
const managementContext = require('./v2/management-context');
const managementFeedback = require('./v2/management-feedback');
const managementSessions = require('./v2/management-sessions');
const managementGovernance = require('./v2/management-governance');
const impactRecords = require('./v2/impact-records');
const impactReviews = require('./v2/impact-reviews');
const managementImpactReviews = require('./v2/management-impact-reviews');
const dataClear = require('./v2/data-clear');

const router = express.Router();

router.use('/me', me);
router.use('/vendor', profile);
router.use('/vendor', vendorSessions);
router.use('/vendor', vendorPublication);
router.use('/management/profile-reviews', profileReviews);
router.use('/management/field-feedback', managementFeedback);
router.use('/management/sessions', managementSessions);
router.use('/management/impact-reviews', managementImpactReviews);
router.use('/management', managementContext);
router.use('/management', managementGovernance);
router.use('/public', publicVendors);
router.use('/me', observations);
router.use('/me', fieldFeedback);
router.use('/me', impactRecords);
router.use('/me', impactReviews);
router.use('/me', dataClear);

module.exports = router;

const express = require('express');

const me = require('./v2/me');
const profile = require('./v2/profile');
const profileReviews = require('./v2/profile-reviews');
const vendorSessions = require('./v2/vendor-sessions');
const vendorPublication = require('./v2/vendor-publication');

const router = express.Router();

router.use('/me', me);
router.use('/vendor', profile);
router.use('/vendor', vendorSessions);
router.use('/vendor', vendorPublication);
router.use('/management/profile-reviews', profileReviews);

module.exports = router;

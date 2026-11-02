const express = require('express');

const me = require('./v2/me');
const profile = require('./v2/profile');
const profileReviews = require('./v2/profile-reviews');

const router = express.Router();

router.use('/me', me);
router.use('/vendor', profile);
router.use('/management/profile-reviews', profileReviews);

module.exports = router;

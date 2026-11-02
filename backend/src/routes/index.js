const express = require('express');

const me = require('./v2/me');

const router = express.Router();

router.use('/me', me);

module.exports = router;

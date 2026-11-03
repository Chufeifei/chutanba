const express = require('express');

const impact = require('../../modules/impact');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 本人影响记录：只给摘要、来源与复核期限，不含反馈人身份与坐标。 */
router.get('/impact-records', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await impact.listMyImpacts(req.identity, req.query));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

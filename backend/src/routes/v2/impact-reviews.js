const express = require('express');

const impact = require('../../modules/impact');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 本人发起影响复核：同一影响的未结复核不重复创建，超过复核期限不再受理。 */
router.post('/impact-reviews', requireIdentity, async (req, res, next) => {
  try {
    const result = await impact.submitReview(
      req.identity, req.get('Idempotency-Key'), req.body,
    );
    return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
  } catch (error) {
    return next(error);
  }
});

/** 本人复核记录：只给申请内容、结论与本人可见理由。 */
router.get('/impact-reviews', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await impact.listMyReviews(req.identity, req.query));
  } catch (error) {
    return next(error);
  }
});

router.get('/impact-reviews/:id', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await impact.getMyReview(req.identity, req.params.id));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

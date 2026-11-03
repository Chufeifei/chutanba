const express = require('express');

const feedbackReview = require('../../modules/feedback-review');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 纠错只作用于指定轮次：不按摊主或事项推断"当前"，避免误关同日新开的轮次。 */
router.post('/:id/corrections', requireIdentity, async (req, res, next) => {
  try {
    const result = await feedbackReview.correctSession(
      req.identity, req.params.id, req.get('Idempotency-Key'), req.body,
    );
    return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

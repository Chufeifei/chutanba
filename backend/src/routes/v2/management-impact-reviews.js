const express = require('express');

const impact = require('../../modules/impact');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 影响复核队列：只给摘要，决定所需的 taskVersion 一并给出。 */
router.get('/', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await impact.listManagementReviews(req.identity, req.query));
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await impact.getManagementReview(req.identity, req.params.id));
  } catch (error) {
    return next(error);
  }
});

/** 复核决定：仅 ADMIN／SUPER_ADMIN；只改影响记录状态，不动治理与本人停止。 */
router.post('/:id/decision', requireIdentity, async (req, res, next) => {
  try {
    const result = await impact.decideReview(
      req.identity, req.params.id, req.get('Idempotency-Key'), req.body,
    );
    return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

const express = require('express');

const feedbackReview = require('../../modules/feedback-review');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 列表只返回摘要；详情逐次鉴权并写受限读取审计。 */
router.get('/', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await feedbackReview.listCases(req.identity, req.query));
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await feedbackReview.getCaseDetail(req.identity, req.params.id));
  } catch (error) {
    return next(error);
  }
});

/** 决定写入必须附幂等键；权限、版本与事实集合都在同一事务内复核。 */
router.post('/:id/decision', requireIdentity, async (req, res, next) => {
  try {
    const result = await feedbackReview.decide(
      req.identity, req.params.id, req.get('Idempotency-Key'), req.body,
    );
    return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

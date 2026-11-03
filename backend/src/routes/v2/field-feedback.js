/**
 * 现场反馈提交与本人记录（契约 §5.3）。
 * 全部端点要求已识别身份；写端点必须带 Idempotency-Key，在途返回 202。
 */
const express = require('express');

const feedback = require('../../modules/feedback');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

router.post('/field-feedback', requireIdentity, async (req, res, next) => {
  try {
    const result = await feedback.submitFeedback(
      req.identity,
      req.get('Idempotency-Key'),
      req.body,
    );
    return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
  } catch (error) {
    return next(error);
  }
});

router.get('/field-feedback', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await feedback.listMyFeedback(req.identity, req.query));
  } catch (error) {
    return next(error);
  }
});

router.get('/field-feedback/:id', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await feedback.getMyFeedback(req.identity, req.params.id));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

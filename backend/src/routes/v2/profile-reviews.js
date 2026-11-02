const express = require('express');

const profile = require('../../modules/profile');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 管理读取每次请求重新鉴权；游标与筛选条件由 service/schema 校验。 */
router.get('/', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await profile.listReviews(req.identity, req.query));
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await profile.getReview(req.identity, req.params.id));
  } catch (error) {
    return next(error);
  }
});

/** 决定写入必须附幂等键；权限与状态判断都在 service 事务内复核。 */
router.post('/:id/decision', requireIdentity, async (req, res, next) => {
  try {
    const result = await profile.decide(
      req.identity, req.params.id, req.get('Idempotency-Key'), req.body,
    );
    return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

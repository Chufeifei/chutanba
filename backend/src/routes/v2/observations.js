/**
 * 观察领取绑定（契约 §5.3 POST /me/observations/claim）。
 * 路由只做协议转换：取幂等键与请求体，PROCESSING 返回 202，错误统一 next(error)。
 */
const express = require('express');

const observation = require('../../modules/observation');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

router.post('/observations/claim', requireIdentity, async (req, res, next) => {
  try {
    const result = await observation.claimObservation(
      req.identity,
      req.get('Idempotency-Key'),
      req.body,
    );
    return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
  } catch (error) {
    return next(error);
  }
});

router.get('/feedback-candidates', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await observation.listCandidates(req.identity, req.query));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

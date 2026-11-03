const express = require('express');

const account = require('../../modules/account');
const publication = require('../../modules/publication');
const session = require('../../modules/session');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 本人公开控制读模型：两类限制与两个版本分别返回，不合并成单一开关。 */
router.get('/publication', requireIdentity, async (req, res, next) => {
  try {
    const actor = await account.resolveAccount(req.identity);
    return success(res, await publication.getSelf(actor.id));
  } catch (error) {
    return next(error);
  }
});

router.post('/publication/stop', requireIdentity, async (req, res, next) => {
  try {
    const result = await session.stopSelfPublication(
      req.identity, req.get('Idempotency-Key'), req.body,
    );
    return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
  } catch (error) {
    return next(error);
  }
});

router.post('/publication/resume', requireIdentity, async (req, res, next) => {
  try {
    const result = await session.resumeSelfPublication(
      req.identity, req.get('Idempotency-Key'), req.body,
    );
    return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

const express = require('express');

const session = require('../../modules/session');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 同一意图仍在处理时按契约返回 202，客户端用原键查询结果（与资料提交一致）。 */
function respond(res, result) {
  return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
}

router.post('/open-attempts', requireIdentity, async (req, res, next) => {
  try {
    return respond(res, await session.createOpenAttempt(req.identity, req.get('Idempotency-Key'), req.body));
  } catch (error) {
    return next(error);
  }
});

router.post('/open-attempts/:id/finish', requireIdentity, async (req, res, next) => {
  try {
    const result = await session.finishOpenAttempt(
      req.identity, req.params.id, req.get('Idempotency-Key'), req.body,
    );
    return respond(res, result);
  } catch (error) {
    return next(error);
  }
});

router.post('/sessions/open', requireIdentity, async (req, res, next) => {
  try {
    return respond(res, await session.openSession(req.identity, req.get('Idempotency-Key'), req.body));
  } catch (error) {
    return next(error);
  }
});

router.post('/sessions/:id/locations', requireIdentity, async (req, res, next) => {
  try {
    const result = await session.refreshLocation(
      req.identity, req.params.id, req.get('Idempotency-Key'), req.body,
    );
    return respond(res, result);
  } catch (error) {
    return next(error);
  }
});

router.post('/sessions/:id/close', requireIdentity, async (req, res, next) => {
  try {
    const result = await session.closeSession(
      req.identity, req.params.id, req.get('Idempotency-Key'), req.body,
    );
    return respond(res, result);
  } catch (error) {
    return next(error);
  }
});

router.get('/workbench', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await session.getWorkbench(req.identity));
  } catch (error) {
    return next(error);
  }
});

router.get('/open-days', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await session.listOpenDays(req.identity, req.query));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

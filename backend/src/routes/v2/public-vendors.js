/**
 * 公开接口绑定层（契约 §5.1）。
 * 公开端点不挂 requireIdentity；身份头只用于决定观察是否签发领取令牌。
 * 路由只做协议转换：无 SQL、无事务、无业务分支，错误统一 next(error)。
 */
const express = require('express');

const discovery = require('../../modules/discovery');
const anonymous = require('../../modules/discovery/anonymous');
const { success } = require('../../utils/response');

const router = express.Router();

/** 解析或签发匿名会话：密钥缺失返回 null，读端点照常工作，写端点自行返回 503。 */
function resolveAnonymousSession(token) {
  if (!anonymous.hasSecret()) return null;
  const nowMs = Date.now();
  if (token && anonymous.verifyToken(token, nowMs)) {
    return { token, hash: anonymous.hashToken(token), issued: false };
  }
  const issuedToken = anonymous.issueToken(nowMs);
  return { token: issuedToken, hash: anonymous.hashToken(issuedToken), issued: true };
}

/** 匿名会话只在 /public 前缀生效；令牌只用于去重与复核归属，不授予权限。 */
function attachAnonymousSession(req, res, next) {
  const resolved = resolveAnonymousSession(req.get('X-Anonymous-Session'));
  req.anonymousSession = resolved;
  if (resolved && resolved.issued) res.set('X-Anonymous-Session', resolved.token);
  return next();
}

/** 公开响应一律不得缓存，避免断网或故障时读到历史坐标。 */
function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  return next();
}

function respond(res, result) {
  return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
}

router.use(attachAnonymousSession);
router.use(noStore);

router.get('/categories', async (req, res, next) => {
  try {
    return success(res, discovery.getCategories());
  } catch (error) {
    return next(error);
  }
});

router.post('/vendors/search', async (req, res, next) => {
  try {
    return success(res, await discovery.searchPublicVendors(req.body));
  } catch (error) {
    return next(error);
  }
});

router.get('/vendors/:id', async (req, res, next) => {
  try {
    return success(res, await discovery.getPublicVendor(req.params.id));
  } catch (error) {
    return next(error);
  }
});

router.post('/vendors/:id/observations', async (req, res, next) => {
  try {
    return respond(res, await discovery.createObservation({
      identity: req.identity,
      vendorId: req.params.id,
      idempotencyKey: req.get('Idempotency-Key'),
      anonymousSession: req.anonymousSession,
      body: req.body,
    }));
  } catch (error) {
    return next(error);
  }
});

router.post('/vendors/:id/navigation-check', async (req, res, next) => {
  try {
    return respond(res, await discovery.checkNavigation({
      identity: req.identity,
      vendorId: req.params.id,
      idempotencyKey: req.get('Idempotency-Key'),
      anonymousSession: req.anonymousSession,
      body: req.body,
    }));
  } catch (error) {
    return next(error);
  }
});

router.post('/navigation-launches', async (req, res, next) => {
  try {
    return respond(res, await discovery.launchNavigation({
      idempotencyKey: req.get('Idempotency-Key'),
      anonymousSession: req.anonymousSession,
      body: req.body,
    }));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

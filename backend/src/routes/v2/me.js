const express = require('express');

const account = require('../../modules/account');
const operation = require('../../modules/operation');
const profile = require('../../modules/profile');
const publication = require('../../modules/publication');
const session = require('../../modules/session');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 本人上下文：身份、授权同步与摊主绑定都由 service 完成，路由只做协议转换。 */
router.get('/', requireIdentity, async (req, res, next) => {
  try {
    const me = await account.getMe(req.identity);
    // 无摊主：只返回账号级字段与资料状态零值（prd Q4），不伪造工作台或空控制。
    if (me.vendorId === undefined) return success(res, { ...me, profileState: 'NONE' });
    // 有摊主时合并资料与公开限制。
    const vendorId = Number(me.vendorId);
    const profileContext = await profile.getSelfContext(vendorId);
    const publicationContext = await publication.getSelfContext(vendorId);
    return success(res, { ...me, ...profileContext, ...publicationContext });
  } catch (error) {
    return next(error);
  }
});

/** 一次性定位上下文：W4 只接受 OPEN/REFRESH，FEEDBACK 留给 W6。 */
router.post('/location-contexts', requireIdentity, async (req, res, next) => {
  try {
    const result = await session.issueLocationContext(
      req.identity, req.get('Idempotency-Key'), req.body,
    );
    return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
  } catch (error) {
    return next(error);
  }
});

/** 原键状态查询只允许原操作身份读取；他人键统一返回未找到，避免枚举。 */
router.get('/operations/:operationType/:key', requireIdentity, async (req, res, next) => {
  try {
    const me = await account.resolveAccount(req.identity);
    const result = await operation.getOperationStatus(
      `account:${me.id}`,
      req.params.operationType,
      req.params.key,
    );
    return success(res, result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

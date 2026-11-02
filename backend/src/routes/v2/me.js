const express = require('express');

const account = require('../../modules/account');
const operation = require('../../modules/operation');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 本人上下文：身份、授权同步与摊主绑定都由 service 完成，路由只做协议转换。 */
router.get('/', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await account.getMe(req.identity));
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

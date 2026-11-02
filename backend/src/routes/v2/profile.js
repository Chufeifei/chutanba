const express = require('express');

const profile = require('../../modules/profile');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 本人资料读模型：状态派生与字段裁剪都在 service/mapper，路由只做协议转换。 */
router.get('/profile', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await profile.getSelfProfile(req.identity));
  } catch (error) {
    return next(error);
  }
});

/** 写入口的 Idempotency-Key 只从请求头取；缺失或非法由 operation/schema 统一返回 VALIDATION_FAILED。 */
router.post('/profile-submissions', requireIdentity, async (req, res, next) => {
  try {
    const result = await profile.submit(req.identity, req.get('Idempotency-Key'), req.body);
    // 同一意图仍在处理时按契约返回 202，客户端用原键查询结果。
    return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
  } catch (error) {
    return next(error);
  }
});

router.get('/profile-submissions/:id', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await profile.getOwnSubmission(req.identity, req.params.id));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

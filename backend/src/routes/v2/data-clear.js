const express = require('express');

const clearance = require('../../modules/clearance');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 清除预览：本人先看受影响范围、当前营业与保留说明，再谈确认。 */
router.get('/data-clear-preview', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await clearance.previewClear(req.identity, req.query));
  } catch (error) {
    return next(error);
  }
});

/** 清除请求：成立即停止公开、结束轮次并冻结待审资料；范围与账号版本缺一不可。 */
router.post('/data-clear-requests', requireIdentity, async (req, res, next) => {
  try {
    const result = await clearance.submitClearRequest(
      req.identity, req.get('Idempotency-Key'), req.body,
    );
    return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
  } catch (error) {
    return next(error);
  }
});

/** 清除进度：已处理范围、保留依据与期限、失败重试状态与超期原因。 */
router.get('/data-clear-requests', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await clearance.listMyRequests(req.identity, req.query));
  } catch (error) {
    return next(error);
  }
});

router.get('/data-clear-requests/:id', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await clearance.getMyRequest(req.identity, req.params.id));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

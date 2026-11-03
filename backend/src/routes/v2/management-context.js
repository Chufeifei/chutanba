const express = require('express');

const management = require('../../modules/management');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 管理入口：能力与待办计数每次请求重新读取，入口可见性不构成权限。 */
router.get('/context', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await management.getContext(req.identity));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

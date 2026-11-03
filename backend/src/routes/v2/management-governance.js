const express = require('express');

const management = require('../../modules/management');
const { requireIdentity } = require('../../middlewares/auth');
const { success } = require('../../utils/response');

const router = express.Router();

/** 摊主检索：只给摘要，不含顾客身份与历史位置。 */
router.get('/vendors', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await management.listVendors(req.identity, req.query));
  } catch (error) {
    return next(error);
  }
});

router.get('/vendors/:id/governance-context', requireIdentity, async (req, res, next) => {
  try {
    return success(res, await management.getGovernanceContext(req.identity, req.params.id));
  } catch (error) {
    return next(error);
  }
});

/** 治理暂停／恢复：仅 ADMIN／SUPER_ADMIN，必带理由与预期版本。 */
router.post('/vendors/:id/governance-decisions', requireIdentity, async (req, res, next) => {
  try {
    const result = await management.decideGovernance(
      req.identity, req.params.id, req.get('Idempotency-Key'), req.body,
    );
    return success(res, result, result && result.status === 'PROCESSING' ? 202 : 200);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

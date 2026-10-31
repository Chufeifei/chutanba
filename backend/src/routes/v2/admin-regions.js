/**
 * 管理端区域字典路由：/api/v2/admin/regions
 *
 * 区域由运营在管理端维护：新增、修改、启停。
 *
 * 两条强制边界，缺一不可：
 * - 鉴权：三条写路由全部经过运营鉴权（可信身份 + 运营白名单），失败关闭。
 *   未授权请求在进入业务逻辑前即被拒绝，区域字典不会被越权篡改。
 * - 幂等：写操作必须携带幂等键（Idempotency-Key），由客户端经 withIdempotency 注入。
 *
 * 停用代替物理删除，以保留历史位置归属的审计可追溯性。
 */

const { DomainError, errors } = require('../../domain/errors');
const { REGION_STATUS } = require('../../domain/region/region-service');
const { createRequireOperator } = require('../../middlewares/operator-auth');

const REQUIRED_FIELDS = ['regionCode', 'regionName', 'cityCode', 'centerLat', 'centerLng', 'radiusM'];

/** 写操作缺少幂等键。错误码与契约层的 IDEMPOTENCY_KEY_INVALID 保持一致。 */
function missingIdempotencyKey() {
  return new DomainError('IDEMPOTENCY_KEY_INVALID', '写操作必须携带 Idempotency-Key', 422);
}

function readIdempotencyKey(req) {
  const headers = req.headers || {};
  const key = headers['idempotency-key'] || headers['Idempotency-Key'];
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

function parseNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 校验并归一化区域写入载荷。 */
function normalizeRegionPayload(body = {}) {
  const payload = {
    regionCode: body.regionCode ? String(body.regionCode).trim() : null,
    regionName: body.regionName ? String(body.regionName).trim() : null,
    cityCode: body.cityCode ? String(body.cityCode).trim() : null,
    centerLat: parseNumber(body.centerLat),
    centerLng: parseNumber(body.centerLng),
    radiusM: parseNumber(body.radiusM),
    sortOrder: parseNumber(body.sortOrder) || 0,
  };

  const missing = REQUIRED_FIELDS.filter((field) => payload[field] === null);
  if (missing.length > 0) {
    throw errors.validation(`缺少区域必填字段：${missing.join('、')}`);
  }
  if (payload.centerLat < -90 || payload.centerLat > 90) {
    throw errors.validation('纬度超出有效范围');
  }
  if (payload.centerLng < -180 || payload.centerLng > 180) {
    throw errors.validation('经度超出有效范围');
  }
  if (payload.radiusM <= 0) {
    throw errors.validation('覆盖半径必须为正数');
  }
  if (!Number.isInteger(payload.radiusM)) {
    throw errors.validation('覆盖半径必须为整数米');
  }
  return payload;
}

function createAdminRegionsRouter({
  router,
  createRegion,
  updateRegion,
  setRegionStatus,
  listAllRegions = null,
  requireOperator = createRequireOperator(),
}) {
  /**
   * 执行运营鉴权，把同步抛出与异步 reject 统一收敛为抛出。
   *
   * 不能依赖「resolve 恰好是同步的」这一隐式约定：若鉴权实现改为查库的异步版本，
   * 同步 try/catch 抓不到 rejection，请求会静默挂起。因此显式处理 thenable 返回值。
   */
  async function authenticate(req, res) {
    await new Promise((resolve, reject) => {
      const forward = (error) => (error ? reject(error) : resolve());
      const outcome = requireOperator(req, res, forward);
      if (outcome && typeof outcome.then === 'function') outcome.then(resolve, reject);
    });
  }

  /** 鉴权 → 执行业务 → 统一响应信封；鉴权先于任何业务校验，不泄露细节给未授权方。 */
  async function handleWrite(req, res, next, run) {
    try {
      await authenticate(req, res);
    } catch (error) {
      return next(error);
    }

    try {
      const result = await run();
      return res.status(200).json({ code: 200, msg: 'ok', data: result });
    } catch (error) {
      return next(error);
    }
  }

  // 管理端区域列表（含停用），供运营核对与维护。
  // 只读同样需要运营鉴权：区域中心点与覆盖半径属于经营信息，不对匿名请求开放。
  router.get('/api/v2/admin/regions', async (req, res, next) => {
    if (typeof listAllRegions !== 'function') {
      return next(errors.managementNotConfigured());
    }
    return handleWrite(req, res, next, async () => ({ items: await listAllRegions() }));
  });

  router.post('/api/v2/admin/regions', async (req, res, next) =>
    handleWrite(req, res, next, async () => {
      const idempotencyKey = readIdempotencyKey(req);
      if (!idempotencyKey) {
        throw missingIdempotencyKey();
      }
      const payload = normalizeRegionPayload(req.body || {});
      return createRegion(payload, { idempotencyKey });
    }));

  router.put('/api/v2/admin/regions/:regionId', async (req, res, next) =>
    handleWrite(req, res, next, async () => {
      const idempotencyKey = readIdempotencyKey(req);
      if (!idempotencyKey) {
        throw missingIdempotencyKey();
      }
      const payload = normalizeRegionPayload(req.body || {});
      return updateRegion(req.params.regionId, payload, { idempotencyKey });
    }));

  // 停用代替物理删除；历史位置归属仍可审计。
  router.delete('/api/v2/admin/regions/:regionId', async (req, res, next) =>
    handleWrite(req, res, next, async () => {
      const idempotencyKey = readIdempotencyKey(req);
      if (!idempotencyKey) {
        throw missingIdempotencyKey();
      }
      return setRegionStatus(req.params.regionId, 'DISABLED', { idempotencyKey });
    }));

  // 重新启用：停用可逆，避免误停用后只能新建区域。
  router.patch('/api/v2/admin/regions/:regionId/status', async (req, res, next) =>
    handleWrite(req, res, next, async () => {
      const idempotencyKey = readIdempotencyKey(req);
      if (!idempotencyKey) {
        throw missingIdempotencyKey();
      }
      const status = (req.body || {}).status;
      if (![REGION_STATUS.ENABLED, REGION_STATUS.DISABLED].includes(status)) {
        throw errors.validation('区域状态非法，仅支持 ENABLED 或 DISABLED');
      }
      return setRegionStatus(req.params.regionId, status, { idempotencyKey });
    }));

  return router;
}

module.exports = { createAdminRegionsRouter, normalizeRegionPayload };

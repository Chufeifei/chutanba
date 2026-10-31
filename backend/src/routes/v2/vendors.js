/**
 * 顾客端发现列表路由：GET|POST /api/v2/vendors
 *
 * 筛选语义（严格按 06-公共业务规则与参数 §7.2.1 与 §7.8）：
 * - 只给 regionId → 按摊主公开位置所属区域过滤，不需要顾客位置。
 * - 给 lat/lng/radiusM → 半径筛选，必须顾客本次提供位置；radiusM 单位为米，边界含端点。
 * - 两者都给 → 区域与半径条件同时满足。
 * - 摊主无公开位置 → 不进入任何依赖位置的结果。
 *
 * 隐私约束：顾客精确坐标属个人位置信息，不得经 GET query 传输——
 * URL 会被网关与访问日志原样记录。带坐标的筛选必须走 POST（body 不进日志）。
 * GET 仅保留不含坐标的区域筛选；GET 带坐标时显式 422，避免「以为已脱敏」。
 */

const { errors } = require('../../domain/errors');

const MAX_RADIUS_M = 50000;

/** 解析查询参数中的字符串数值，缺失或非法时返回 null。 */
function parseNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 解析查询参数中的字符串，缺失时返回 null。 */
function parseString(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

/**
 * 校验并归一化位置筛选参数。
 * 半径存在但缺少顾客位置、或坐标越界、或半径非正整数时抛 VALIDATION_FAILED，
 * 不得静默忽略筛选条件。
 */
function normalizeLocationFilters(query = {}) {
  const regionId = parseString(query.regionId);
  const lat = parseNumber(query.lat);
  const lng = parseNumber(query.lng);
  const radiusRaw = parseString(query.radiusM);
  const radiusM = radiusRaw === null ? null : Number(radiusRaw);

  if (radiusRaw !== null && (!Number.isFinite(radiusM) || radiusM <= 0)) {
    throw errors.validation('半径必须为正数');
  }
  if (radiusM !== null && !Number.isInteger(radiusM)) {
    throw errors.validation('半径必须为整数米');
  }
  if (radiusM !== null && radiusM > MAX_RADIUS_M) {
    throw errors.validation(`半径不得超过 ${MAX_RADIUS_M} 米`);
  }
  if (radiusM !== null && (lat === null || lng === null)) {
    throw errors.validation('按半径筛选必须提供顾客本次位置');
  }
  if (lat !== null && (lat < -90 || lat > 90)) {
    throw errors.validation('纬度超出有效范围');
  }
  if (lng !== null && (lng < -180 || lng > 180)) {
    throw errors.validation('经度超出有效范围');
  }
  if ((lat === null) !== (lng === null)) {
    throw errors.validation('经纬度必须同时提供');
  }

  return { regionId, lat, lng, radiusM };
}

/** 组装服务层入参：位置筛选来自 query 或 body，业务筛选一律显式拒绝。 */
function buildVendorFilters(params, { allowCoordinates }) {
  const location = normalizeLocationFilters(params);
  if (!allowCoordinates && (location.lat !== null || location.lng !== null)) {
    throw errors.validation('顾客精确位置不得经 GET 查询串传输，请改用 POST');
  }
  const keyword = parseString(params.keyword);
  const categoryCode = parseString(params.categoryCode);
  const operationStatus = parseString(params.status);
  const unsupported = [
    ['keyword', keyword],
    ['categoryCode', categoryCode],
    ['status', operationStatus],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (unsupported.length > 0) {
    throw errors.validation(
      `当前版本不支持筛选条件：${unsupported.map(([name]) => name).join('、')}`,
    );
  }
  return {
    keyword,
    categoryCode,
    operationStatus,
    regionId: location.regionId,
    lat: location.lat,
    lng: location.lng,
    radiusM: location.radiusM,
  };
}

/**
 * 创建发现列表路由。
 * @param {object} deps 依赖注入，便于测试替换服务实现。
 */
function createVendorsRouter({ router, listVendors }) {
  async function respond(buildFilters, res, next) {
    try {
      const filters = buildFilters();
      const result = await listVendors(filters);
      return res.status(200).json({ code: 200, msg: 'ok', data: result });
    } catch (error) {
      return next(error);
    }
  }

  // 不含顾客坐标的区域筛选：可缓存、可分享。
  router.get('/api/v2/vendors', async (req, res, next) =>
    respond(() => buildVendorFilters(req.query || {}, { allowCoordinates: false }), res, next));

  // 含顾客坐标的半径筛选：走 body，避免坐标进入访问日志。
  router.post('/api/v2/vendors/search', async (req, res, next) =>
    respond(() => buildVendorFilters(req.body || {}, { allowCoordinates: true }), res, next));

  return router;
}

module.exports = { createVendorsRouter, normalizeLocationFilters, MAX_RADIUS_M };

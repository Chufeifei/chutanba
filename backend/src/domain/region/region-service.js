/**
 * 区域字典服务：顾客端读取与管理端维护。
 *
 * 区域是平台自定义的经营片区（中心点 + 覆盖半径），不是行政区划。
 * 停用代替物理删除，以保留历史位置归属的审计可追溯性。
 *
 * 服务以工厂形式提供，便于注入查询执行器进行单测；默认使用真实数据库连接池。
 */

const defaultQuery = require('../../db/query');
const { errors } = require('../errors');

const REGION_STATUS = Object.freeze({ ENABLED: 'ENABLED', DISABLED: 'DISABLED' });

/** 区域编码唯一索引冲突的业务码：重复请求应返回同一结果而非报错。 */
const REGION_CODE_DUPLICATE = 'ER_DUP_ENTRY';

/**
 * 归一化区域标识。
 * 区域主键为 BIGINT UNSIGNED，传入的字符串统一转为数值参与比较，
 * 避免字符串与数值混比导致索引失效（M4）。
 */
function normalizeRegionId(regionId) {
  if (regionId === undefined || regionId === null || regionId === '') {
    throw errors.validation('区域标识不能为空');
  }
  const value = Number(regionId);
  if (!Number.isInteger(value) || value <= 0) {
    throw errors.validation('区域标识非法');
  }
  return value;
}

/** 幂等键取值：路由层已保证存在，服务层再校验一次避免被绕过调用。 */
function normalizeIdempotencyKey(idempotencyKey) {
  if (idempotencyKey === undefined || idempotencyKey === null || String(idempotencyKey).trim() === '') {
    throw errors.validation('写操作必须携带 Idempotency-Key');
  }
  return String(idempotencyKey).trim();
}

/**
 * 判定更新是否命中了不存在的区域。
 * affectedRows === 0 有两种含义：区域不存在，或字段值恰好与现值相同（MySQL 默认不报告变更行）。
 * 因此必须回查存在性，否则「重复提交相同内容」会被误报为 404。
 */
async function ensureRegionExists(runner, regionId) {
  const [rows] = await runner('SELECT id FROM cb_location_region WHERE id = ? LIMIT 1', [regionId]);
  if (!rows || rows.length === 0) {
    throw errors.notFound('区域不存在');
  }
}

/** 按幂等键回查已创建的区域；未配置列或未命中时返回 null。 */
async function findByIdempotencyKey(runner, key) {
  const [rows] = await runner('SELECT id FROM cb_location_region WHERE idempotency_key = ? LIMIT 1', [key]);
  return rows && rows.length > 0 ? rows[0] : null;
}

function createRegionService(dependencies = {}) {
  const { query = defaultQuery.query, execute = defaultQuery.execute } = dependencies;

  /**
   * 顾客端可读取的启用区域列表。
   * 只返回标识与名称，不返回中心点与半径等几何信息。
   */
  async function listEnabledRegions() {
    const [rows] = await query(
      `SELECT id, region_name, city_code
       FROM cb_location_region
       WHERE status = ?
       ORDER BY sort_order ASC, id ASC`,
      [REGION_STATUS.ENABLED],
    );
    return rows.map((row) => ({
      regionId: String(row.id),
      regionName: row.region_name,
      cityCode: row.city_code,
    }));
  }

  /** 管理端读取全部区域（含停用）。 */
  async function listAllRegions() {
    const [rows] = await query(
      `SELECT id, region_code, region_name, city_code, center_lat, center_lng, radius_m, status, sort_order
       FROM cb_location_region
       ORDER BY sort_order ASC, id ASC`,
    );
    return rows.map((row) => ({
      regionId: String(row.id),
      regionCode: row.region_code,
      regionName: row.region_name,
      cityCode: row.city_code,
      centerLat: Number(row.center_lat),
      centerLng: Number(row.center_lng),
      radiusM: Number(row.radius_m),
      status: row.status,
      sortOrder: Number(row.sort_order),
    }));
  }

  /**
   * 新增区域。
   *
   * 幂等语义：区域编码唯一索引是最终幂等基底。同一 Idempotency-Key 重放时，
   * 命中 region_code 唯一索引冲突后回查已存在记录并返回同一 regionId，
   * 而不抛冲突——避免网络重试让运营看到误导性报错。
   *
   * 幂等键同时参与去重：同一幂等键不得创建两条区域，即使区域编码不同。
   * 这是与「仅靠唯一索引」的关键差异，否则重试换了个载荷就会绕过幂等。
   */
  async function createRegion(payload, { nowMs = Date.now(), idempotencyKey = null } = {}) {
    const key = normalizeIdempotencyKey(idempotencyKey);
    const replay = await findByIdempotencyKey(query, key);
    if (replay) {
      return { regionId: String(replay.id), idempotentReplay: true };
    }
    try {
      const [result] = await execute(
        `INSERT INTO cb_location_region
          (region_code, region_name, city_code, center_lat, center_lng, radius_m, status, sort_order, idempotency_key, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.regionCode,
          payload.regionName,
          payload.cityCode,
          payload.centerLat,
          payload.centerLng,
          payload.radiusM,
          REGION_STATUS.ENABLED,
          payload.sortOrder,
          key,
          nowMs,
          nowMs,
        ],
      );
      return { regionId: String(result.insertId), idempotentReplay: false };
    } catch (error) {
      if (error && error.code === REGION_CODE_DUPLICATE) {
        const [rows] = await query('SELECT id FROM cb_location_region WHERE region_code = ? LIMIT 1', [
          payload.regionCode,
        ]);
        if (rows && rows.length > 0) {
          return { regionId: String(rows[0].id), idempotentReplay: true };
        }
        throw errors.conflict('CONCURRENT_CONFLICT', '区域编码已存在');
      }
      throw error;
    }
  }

  /** 修改区域。 */
  async function updateRegion(regionId, payload, { nowMs = Date.now(), idempotencyKey = null } = {}) {
    const id = normalizeRegionId(regionId);
    normalizeIdempotencyKey(idempotencyKey);
    const [result] = await execute(
      `UPDATE cb_location_region
       SET region_code = ?, region_name = ?, city_code = ?, center_lat = ?, center_lng = ?,
           radius_m = ?, sort_order = ?, updated_at_ms = ?
       WHERE id = ?`,
      [
        payload.regionCode,
        payload.regionName,
        payload.cityCode,
        payload.centerLat,
        payload.centerLng,
        payload.radiusM,
        payload.sortOrder,
        nowMs,
        id,
      ],
    );
    // 内容无变化时 affectedRows 为 0，不能据此判定区域不存在。
    if (result.affectedRows === 0) {
      await ensureRegionExists(query, id);
    }
    return { regionId: String(id), changed: result.affectedRows > 0, idempotentReplay: false };
  }

  /** 启用或停用区域。停用不物理删除。 */
  async function setRegionStatus(regionId, status, { nowMs = Date.now(), idempotencyKey = null } = {}) {
    const id = normalizeRegionId(regionId);
    normalizeIdempotencyKey(idempotencyKey);
    if (![REGION_STATUS.ENABLED, REGION_STATUS.DISABLED].includes(status)) {
      throw errors.validation('区域状态非法');
    }
    const [result] = await execute(
      `UPDATE cb_location_region SET status = ?, updated_at_ms = ? WHERE id = ?`,
      [status, nowMs, id],
    );
    if (result.affectedRows === 0) {
      await ensureRegionExists(query, id);
    }
    return { regionId: String(id), status, changed: result.affectedRows > 0, idempotentReplay: false };
  }

  return {
    createRegion,
    listAllRegions,
    listEnabledRegions,
    setRegionStatus,
    updateRegion,
  };
}

const regionService = createRegionService();

module.exports = {
  REGION_STATUS,
  createRegionService,
  normalizeRegionId,
  ...regionService,
};
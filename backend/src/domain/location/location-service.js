/**
 * 摊主公开位置服务：权威写入、公开资格过滤与候选查询。
 *
 * 写入边界：位置落区与位置写入在同一事务内完成，保证共享对象只有一个权威写入边界。
 * 读路径：公开资格在查询侧直接判定（public_status='PUBLIC' AND public_until_ms > now），
 * 到期即刻生效，不依赖任何异步任务保证正确性。
 *
 * 服务以工厂形式提供，便于注入查询执行器与连接进行单测；默认使用真实数据库连接池。
 */

const defaultQuery = require('../../db/query');
const {
  LOCATION_KIND,
  PUBLIC_STATUS,
  computePublicUntilMsForKind,
  resolveRegion,
} = require('./public-position');
const { REGION_STATUS } = require('../region/region-service');
const { errors } = require('../errors');
const { BUSINESS_TIMEZONE } = require('../../config/business-time');

const SELECT_BASE_COLUMNS = `
  l.vendor_id AS vendorId,
  l.location_kind AS locationKind,
  l.lat AS lat,
  l.lng AS lng,
  l.location_name AS locationName,
  l.region_id AS regionId,
  l.public_until_ms AS publicUntilMs,
  l.published_at_ms AS publishedAtMs
`;

function createLocationService(dependencies = {}) {
  const {
    query = defaultQuery.query,
    execute = defaultQuery.execute,
    transaction = defaultQuery.transaction,
    connection = null,
  } = dependencies;

  /** 写操作使用注入的连接（测试替身），否则走默认执行器。返回 [result, fields]。 */
  async function runWrite(sql, params) {
    if (connection) {
      const result = await connection.execute(sql, params);
      return Array.isArray(result) ? result : [result, []];
    }
    return execute(sql, params);
  }

  /**
   * 读取落区候选区域。
   *
   * 距离在数据库侧用 ST_Distance_Sphere 计算，与半径筛选的读路径共用同一口径，
   * 避免「落区时判为区内、筛选时判为区外」的双实现偏差。
   * 只取覆盖半径内的候选，resolveRegion 直接采信返回的 distanceM 字段。
   */
  async function loadEnabledRegions(conn = null, point = null) {
    const runner = conn ? conn.query.bind(conn) : query;
    const params = [];
    let distanceSelect = 'NULL AS distanceM';
    let distanceFilter = '';
    let orderBy = 'sort_order ASC, id ASC';
    if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
      distanceSelect = 'ST_Distance_Sphere(POINT(center_lng, center_lat), POINT(?, ?)) AS distanceM';
      params.push(point.lng, point.lat);
      distanceFilter = 'AND ST_Distance_Sphere(POINT(center_lng, center_lat), POINT(?, ?)) <= radius_m';
      params.push(point.lng, point.lat);
      // 按距离升序：重叠区域取最近的那个，落区结果可预期。
      orderBy = 'distanceM ASC, sort_order ASC, id ASC';
    }
    const [rows] = await runner(
      `SELECT id, region_code, region_name, city_code, center_lat, center_lng, radius_m, ${distanceSelect}
       FROM cb_location_region
       WHERE status = 'ENABLED'
       ${distanceFilter}
       ORDER BY ${orderBy}`,
      params,
    );
    return rows;
  }

  /**
   * 发布一个摊主的当前公开位置，并在同一事务内完成落区。
   *
   * @param {object} params
   * @param {number} params.vendorId 摊主标识
   * @param {string} params.locationKind CURRENT_NAVIGATION | RECENT_LAST
   * @param {number} params.lat 纬度（GCJ-02）
   * @param {number} params.lng 经度（GCJ-02）
   * @param {string} params.locationName 位置名称
   * @param {number} params.lastLocatedAtMs 最后一次成功营业定位时刻（毫秒）
   * @param {number} params.nowMs 当前时刻（毫秒）
   */
  async function publishPosition({ vendorId, locationKind, lat, lng, locationName, lastLocatedAtMs, nowMs }) {
    if (!Number.isFinite(vendorId)) {
      throw new TypeError('vendorId 必须为有效数值');
    }
    if (![LOCATION_KIND.CURRENT_NAVIGATION, LOCATION_KIND.RECENT_LAST].includes(locationKind)) {
      throw new TypeError('locationKind 非法');
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw new TypeError('纬度超出有效范围');
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new TypeError('经度超出有效范围');
    }

    // 两种 kind 的公开期语义不同：当前导航地址持续有效，最近出摊位置为7 日公开期。
    const publicUntilMs = computePublicUntilMsForKind({
      locationKind,
      lastLocatedAtMs,
      businessTimezone: BUSINESS_TIMEZONE,
    });

    // 事务执行器：
    // - 未注入 connection 时走连接池事务（生产路径，BEGIN/COMMIT/ROLLBACK 由 query.transaction 负责）。
    // - 注入了 connection 时仍要求该连接自行实现 begin/commit/rollback 并在回调中调用，
    //   否则等于把「同一权威写入边界」降级为裸连接，测试会给出原子性的虚假安全感。
    //   连接替身缺少事务方法时明确拒绝，而不是静默降级。
    const runInTransaction = connection
      ? async (fn) => {
        if (typeof connection.beginTransaction !== 'function') {
          throw new Error('注入的连接必须实现 beginTransaction/commit/rollback，否则位置写入不是原子的');
        }
        await connection.beginTransaction();
        try {
          const result = await fn(connection);
          await connection.commit();
          return result;
        } catch (error) {
          await connection.rollback();
          throw error;
        }
      }
      : transaction;

    return runInTransaction(async (conn) => {
      const regions = await loadEnabledRegions(conn, { lat, lng });
      // 候选已在数据库侧按半径筛选，此处 resolveRegion 仍保留距离与边界判定作为防御。
      const region = resolveRegion({ point: { lat, lng }, regions });
      const regionId = region ? region.id : null;

      // 同一摊主只保留一条当前公开位置；旧位置置为 SUPERSEDED，保留审计与申诉所需历史。
      await conn.execute(
        `UPDATE cb_vendor_locations
         SET public_status = ?, updated_at_ms = ?
         WHERE vendor_id = ? AND public_status = ?`,
        [PUBLIC_STATUS.SUPERSEDED, nowMs, vendorId, PUBLIC_STATUS.PUBLIC],
      );

      await conn.execute(
        `INSERT INTO cb_vendor_locations
          (vendor_id, location_kind, lat, lng, location_name, region_id,
           public_until_ms, public_status, published_at_ms, last_located_at_ms, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          vendorId,
          locationKind,
          lat,
          lng,
          locationName,
          regionId,
          publicUntilMs,
          PUBLIC_STATUS.PUBLIC,
          nowMs,
          Number.isFinite(lastLocatedAtMs) ? lastLocatedAtMs : nowMs,
          nowMs,
          nowMs,
        ],
      );

      return { vendorId, regionId, publicUntilMs, locationKind };
    });
  }

  /**
   * 摊主主动停止公开最近出摊位置。
   * 已停止或已到期的位置不得恢复；下一次成功出摊或刷新定位才形成新的公开位置。
   */
  async function stopPublicPosition({ vendorId, nowMs }) {
    const [result] = await runWrite(
      `UPDATE cb_vendor_locations
       SET public_status = ?, stopped_at_ms = ?, updated_at_ms = ?
       WHERE vendor_id = ? AND public_status = ?`,
      [PUBLIC_STATUS.STOPPED, nowMs, nowMs, vendorId, PUBLIC_STATUS.PUBLIC],
    );
    return { vendorId, stopped: result.affectedRows > 0 };
  }

  /**
   * 把已到期且仍标记为公开的「最近出摊位置」终态化。
   *
   * 条件更新保证重复执行结果一致（幂等）。
   * 显式排除 CURRENT_NAVIGATION：该类型持续有效，不存在到期可能。
   */
  async function expirePositions({ nowMs, batchSize = 500 }) {
    const [result] = await runWrite(
      `UPDATE cb_vendor_locations
       SET public_status = ?, updated_at_ms = ?
       WHERE public_status = ? AND location_kind = ? AND public_until_ms <= ?
       LIMIT ?`,
      [PUBLIC_STATUS.EXPIRED, nowMs, PUBLIC_STATUS.PUBLIC, LOCATION_KIND.RECENT_LAST, nowMs, batchSize],
    );
    return { expired: result.affectedRows };
  }

  /**
   * 位置资格候选查询（以位置为驱动）。
   *
   * - 前置条件恒为「当前仍公开」：public_status='PUBLIC' AND public_until_ms > now
   *   AND published_at_ms <= now（写入侧 now 单调，防御时钟回拨造成的未来位置）。
   * - 给出 regionId 时按摊主公开位置所属区域过滤，不需要顾客位置。
   *   同时要求区域仍为 ENABLED：区域停用后不得再作为筛选命中（对齐区域字典的顾客可见性）。
   * - 给出 origin 与 radiusM 时按球面距离过滤，边界含端点（<= radiusM）。
   * - 排序口径：按距离升序（无半径筛选时为 NULL，退化为区域 + 摊主稳定序）。
   */
  async function listPublicLocations({ regionId = null, origin = null, radiusM = null, nowMs }) {
    const conditions = ['l.public_status = ?', 'l.public_until_ms > ?', 'l.published_at_ms <= ?'];
    const whereParams = [PUBLIC_STATUS.PUBLIC, nowMs, nowMs];
    const selectParams = [];

    let distanceSelect = 'NULL AS distanceM';
    if (origin && Number.isFinite(radiusM)) {
      // ST_Distance_Sphere 的第一个点为摊主位置，第二个点为顾客位置；单位为米，边界含端点。
      distanceSelect = 'ST_Distance_Sphere(POINT(l.lng, l.lat), POINT(?, ?)) AS distanceM';
      selectParams.push(origin.lng, origin.lat);
      // 包围盒预筛：先用经纬度区间粗过滤，再算球面距离，降低参与距离计算的行数。
      //
      // 每度对应米数必须取球面模型的真实值（M ≈ 2πR/360 ≈ 111195 m），并向外放大，
      // 否则包围盒会小于真实覆盖范围，把恰好落在半径边缘的合法摊位在SQL 层就剔除，
      // 造成「服务层算出在半径内、查询却查不到」的空结果。
      const SAFE_METERS_PER_DEGREE = 111000;
      const latDelta = radiusM / SAFE_METERS_PER_DEGREE;
      const lngDelta = radiusM / (SAFE_METERS_PER_DEGREE * Math.cos((origin.lat * Math.PI) / 180));
      conditions.push('l.lat BETWEEN ? AND ?');
      whereParams.push(origin.lat - latDelta, origin.lat + latDelta);
      conditions.push('l.lng BETWEEN ? AND ?');
      whereParams.push(origin.lng - lngDelta, origin.lng + lngDelta);
      conditions.push('ST_Distance_Sphere(POINT(l.lng, l.lat), POINT(?, ?)) <= ?');
      whereParams.push(origin.lng, origin.lat, radiusM);
    }

    if (regionId !== null && regionId !== undefined && regionId !== '') {
      conditions.push('l.region_id = ?');
      whereParams.push(Number(regionId));
      // 区域停用后不再作为筛选命中：顾客端区域字典只暴露 ENABLED，两端口径必须一致。
      conditions.push('EXISTS (SELECT 1 FROM cb_location_region r WHERE r.id = l.region_id AND r.status = ?)');
      whereParams.push(REGION_STATUS.ENABLED);
    }

    const sql = `SELECT ${SELECT_BASE_COLUMNS}, ${distanceSelect}
       FROM cb_vendor_locations l
       WHERE ${conditions.join(' AND ')}
       ORDER BY distanceM ASC, l.region_id ASC, l.vendor_id ASC`;

    const [rows] = await query(sql, [...selectParams, ...whereParams]);
    return rows;
  }

  /**
   * 供路由层使用：按筛选条件返回发现列表。
   *
   * 本批交付范围是「位置资格 + 区域 / 半径筛选」。keyword / categoryCode / operationStatus
   * 依赖摊主主数据与商品表，属于其他批次能力：显式拒绝而非静默丢弃，
   * 避免调用方误以为筛选已生效而拿到未过滤的全集。
   */
  async function listVendors({
    regionId,
    lat,
    lng,
    radiusM,
    keyword = null,
    categoryCode = null,
    operationStatus = null,
    nowMs = Date.now(),
  }) {
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

    const origin = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    const items = await listPublicLocations({ regionId, origin, radiusM, nowMs });
    return {
      items: items.map((row) => ({
        vendorId: row.vendorId,
        locationKind: row.locationKind,
        locationName: row.locationName,
        regionId: row.regionId === null || row.regionId === undefined ? null : String(row.regionId),
        lat: Number(row.lat),
        lng: Number(row.lng),
        distanceM: row.distanceM === null || row.distanceM === undefined ? null : Number(row.distanceM),
        publicUntilMs: Number(row.publicUntilMs),
        publishedAtMs: Number(row.publishedAtMs),
      })),
      filters: {
        keyword: null,
        categoryCode: null,
        operationStatus: null,
        regionId,
        radiusM,
        usedCustomerLocation: Boolean(origin),
      },
    };
  }

  return {
    expirePositions,
    listPublicLocations,
    listVendors,
    loadEnabledRegions,
    publishPosition,
    stopPublicPosition,
  };
}

const locationService = createLocationService();

module.exports = {
  createLocationService,
  ...locationService,
};

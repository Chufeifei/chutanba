/**
 * 摊主公开位置的纯领域逻辑：公开期计算、公开资格判定、圆形区域落区与球面距离。
 *
 * 本模块不做 IO，不依赖数据库，便于单测。距离计算默认使用 Haversine；
 * 若运行环境改用 MySQL ST_Distance_Sphere，只需替换注入的距离函数，口径与
 * 「边界含端点」的约定保持不变。
 */

const { BUSINESS_TIMEZONE, PUBLIC_PERIOD_DAYS } = require('../../config/business-time');

/** 地球平均半径（米），用于 Haversine 球面距离。 */
const EARTH_RADIUS_M = 6371008.8;

const PUBLIC_STATUS = Object.freeze({
  PUBLIC: 'PUBLIC',
  SUPERSEDED: 'SUPERSEDED',
  STOPPED: 'STOPPED',
  EXPIRED: 'EXPIRED',
});

const LOCATION_KIND = Object.freeze({
  CURRENT_NAVIGATION: 'CURRENT_NAVIGATION',
  RECENT_LAST: 'RECENT_LAST',
});

/** 某时区在给定时刻的 UTC 偏移（毫秒）。 */
function timezoneOffsetMs(instantMs, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const part of formatter.formatToParts(new Date(instantMs))) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '00' : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instantMs;
}

/**
 * 计算「自起始时刻起第 N 个自然日的相同本地时刻」对应的 UTC 毫秒。
 * 该时刻为左闭右开区间的右端点（不含该时刻本身）。
 */
function addLocalDays(instantMs, days, timeZone) {
  const offset = timezoneOffsetMs(instantMs, timeZone);
  const localMs = instantMs + offset;
  const localDate = new Date(localMs);
  const shifted = Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate() + days,
    localDate.getUTCHours(),
    localDate.getUTCMinutes(),
    localDate.getUTCSeconds(),
    localDate.getUTCMilliseconds(),
  );
  // 反向求解真实 UTC 时刻；跨夏令时边界时用一次偏移修正收敛。
  let result = shifted - offset;
  const correctedOffset = timezoneOffsetMs(result, timeZone);
  if (correctedOffset !== offset) {
    result = shifted - correctedOffset;
  }
  return result;
}

/**
 * 最近出摊位置的公开截止时刻：最后一次成功营业定位时刻起第 7 日相同本地时刻。
 * 公开期不因收摊或请假重新起算。
 */
function computePublicUntilMs({ lastLocatedAtMs, businessTimezone = BUSINESS_TIMEZONE, days = PUBLIC_PERIOD_DAYS }) {
  if (!Number.isFinite(lastLocatedAtMs)) {
    throw new TypeError('lastLocatedAtMs 必须是有效的毫秒时间戳');
  }
  return addLocalDays(lastLocatedAtMs, days, businessTimezone);
}

/**
 * 「出摊中当前导航地址」的公开截止时刻：持续有效。
 *
 * 该地址是摊主当下正在出摊的地点，只要状态仍是出摊中就一直有效，
 * 不适用「最近出摊位置」的 7 日公开期。其失效只由终态控制：
 * 收摊/请假（STOPPED）、被新位置取代（SUPERSEDED）、区域停用后不再落区。
 *
 * 用一个远大于任何真实时刻的哨兵值而非 NULL，好处是读路径只需一条
 * `public_until_ms > now` 条件即可同时覆盖两种 kind，无需 OR 分支，
 * 也让索引能正常参与范围扫描。
 */
const PUBLIC_UNTIL_FOREVER_MS = Number.MAX_SAFE_INTEGER;

/**
 * 按位置类型计算公开截止时刻。
 * - RECENT_LAST：最后一次成功营业定位时刻起第 7 日相同本地时刻（公开期不因收摊重新起算）。
 * - CURRENT_NAVIGATION：持续有效。
 */
function computePublicUntilMsForKind({
  locationKind,
  lastLocatedAtMs,
  businessTimezone = BUSINESS_TIMEZONE,
  days = PUBLIC_PERIOD_DAYS,
}) {
  if (locationKind === LOCATION_KIND.CURRENT_NAVIGATION) {
    return PUBLIC_UNTIL_FOREVER_MS;
  }
  if (locationKind === LOCATION_KIND.RECENT_LAST) {
    return computePublicUntilMs({ lastLocatedAtMs, businessTimezone, days });
  }
  throw new TypeError('locationKind 非法');
}

/**
 * 位置当前是否对顾客公开。
 * 仅 PUBLIC 且未到达公开截止时刻时公开；截止时刻即刻失效（左闭右开）。
 */
function isPositionPublic({ publicStatus, publicUntilMs, nowMs }) {
  if (publicStatus !== PUBLIC_STATUS.PUBLIC) return false;
  if (!Number.isFinite(nowMs) || !Number.isFinite(publicUntilMs)) return false;
  return nowMs < publicUntilMs;
}

/**
 * 球面距离（米），Haversine 公式。
 */
function distanceMeters(a, b) {
  const toRadians = (degree) => (degree * Math.PI) / 180;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

/**
 * 落区：返回距离最小且落在覆盖半径内的区域；无匹配返回 null。
 * 边界含端点：距离恰好等于半径时视为命中。
 *
 * 距离来源优先使用区域行上的 `distanceM`（由数据库 ST_Distance_Sphere 计算）：
 * 落区与半径筛选必须共用同一套距离口径，否则会出现「筛选判定在半径内、落区判定
 * 不属于该区域」的自相矛盾——MySQL 球面半径（R=6370986）与 JS Haversine 取值
 * （EARTH_RADIUS_M）相差约 3.6ppm，在边界上足以翻转判定结果。
 * 仅当区域行未带distanceM 时才回落到 JS Haversine，保持纯函数可独立测试。
 */
function resolveRegion({ point, regions = [], distance = distanceMeters }) {
  if (!point || !Array.isArray(regions) || regions.length === 0) return null;

  let best = null;
  let bestDistance = Infinity;
  for (const region of regions) {
    if (!region) continue;
    const radius = Number(region.radius_m);
    if (!Number.isFinite(radius) || radius <= 0) continue;
    // 数据库已算好距离时直接采信，避免第二套实现改写判定结果。
    const meters = Number.isFinite(Number(region.distanceM))
      ? Number(region.distanceM)
      : distance(point, {
        lat: Number(region.center_lat),
        lng: Number(region.center_lng),
      });
    if (!Number.isFinite(meters) || meters > radius) continue;
    if (meters < bestDistance) {
      best = region;
      bestDistance = meters;
    }
  }
  return best;
}

module.exports = {
  EARTH_RADIUS_M,
  LOCATION_KIND,
  PUBLIC_STATUS,
  PUBLIC_UNTIL_FOREVER_MS,
  addLocalDays,
  computePublicUntilMs,
  computePublicUntilMsForKind,
  distanceMeters,
  isPositionPublic,
  resolveRegion,
  timezoneOffsetMs,
};

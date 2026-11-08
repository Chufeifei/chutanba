/**
 * P01 地图标记与空态归因（纯函数）。
 *
 * 两条约束决定这里只做"同源转换"：
 * 1. 列表与地图必须共用同一份公开集合（需求 C-01、页面方案 §3.1），
 *    因此标记只能由已取回的 items 派生，不能在地图模式下另行请求；
 * 2. 标记与列表项通过下标一一对应，点击标记回查 items[index]，
 *    不引入第二份"地图专用"数据，避免两处顺序漂移。
 */
const { getCategoryName } = require('../../config/categories');

// 微信 <map> 的 marker.iconPath 只认位图，svg 不渲染（生成脚本见 scripts/generate-map-marker.js）
const MARKER_ICON = '/assets/icons/map-marker.png';
const MARKER_WIDTH = 28;
const MARKER_HEIGHT = 34;

/**
 * 公开集合 → 地图标记。
 * 没有坐标的项直接跳过：宁可少一个点，也不能用 0,0 或上次缓存位置补点。
 * @param {Array<{vendorId: string, currentLocation?: {lat: number, lng: number}}>} items
 * @returns {Array<{id: number, latitude: number, longitude: number, iconPath: string, width: number, height: number}>}
 */
function toMarkers(items) {
  if (!Array.isArray(items)) return [];
  const markers = [];
  items.forEach((item, index) => {
    const location = item && item.currentLocation;
    if (!location) return;
    const latitude = Number(location.lat);
    const longitude = Number(location.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    markers.push({
      id: index,
      latitude,
      longitude,
      iconPath: MARKER_ICON,
      width: MARKER_WIDTH,
      height: MARKER_HEIGHT,
      anchor: { x: 0.5, y: 1 },
    });
  });
  return markers;
}

/** 标记 id 即 items 下标，越界一律返回 null，避免点到过时标记读到别人的摊位。 */
function vendorIdAt(items, markerId) {
  const index = Number(markerId);
  if (!Number.isInteger(index) || index < 0 || !Array.isArray(items) || index >= items.length) {
    return null;
  }
  const item = items[index];
  return item ? item.vendorId : null;
}

/**
 * 空态必须区分"没有供给"与"该品类没有"：
 * 顾客按品类筛选后看到"当前没有摊位"会以为整片区域空摊，改文案成本极低。
 */
function emptyReasonOf({ categoryCode } = {}) {
  if (categoryCode) {
    const name = getCategoryName(categoryCode);
    return {
      title: `暂时没有营业中的${name}`,
      description: '可以切换其他品类，或稍后再来看看',
    };
  }
  return {
    title: '当前没有正在营业的摊位',
    description: '试点片区的摊主开摊后会出现在这里',
  };
}

/**
 * 定位失败时的局部提示：明确"仍可浏览"，避免用户以为页面坏了。
 * 拒绝授权与"暂时取不到位置"分开说，否则用户不知道要不要去改设置。
 */
function locationHintOf(resolved) {
  if (!resolved || resolved.location) return '';
  if (resolved.denied) return '未获得位置授权';
  return resolved.message || '暂时无法取得位置';
}

module.exports = {
  MARKER_ICON,
  toMarkers,
  vendorIdAt,
  emptyReasonOf,
  locationHintOf,
};

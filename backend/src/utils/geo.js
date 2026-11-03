/**
 * 球面距离（米）。只做几何计算，不含业务阈值：
 * 阈值与判定分别由调用方持有（公开投影的距离展示、现场反馈的 300 米受理）。
 * 返回未取整值，避免先取整再比较造成边界误判。
 */
const EARTH_RADIUS_M = 6371008.8;

function toRad(value) {
  return (value * Math.PI) / 180;
}

function haversineMeters(from, to) {
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

module.exports = { haversineMeters };

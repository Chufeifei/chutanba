/**
 * P01 找摊的业务编排（唯一取数入口）。
 *
 * 两件容易做错的事在这里收口：
 * 1. 顾客定位只用于"本次距离计算"。取不到就降级为无距离浏览，
 *    不能因为拒绝授权就不给看摊位（需求 C-01、AC-01）；
 * 2. 只取一次定位。品类切换、轮询复核都复用同一次授权结果，
 *    否则每 2 秒轮询都会重新弹一次授权或反复定位耗电。
 *
 * 坐标本身不进页面 data 的卡片模型，只有地图标记需要它。
 */
const publicApi = require('../../api/public');
const location = require('../../utils/location');
const mapper = require('./mapper');
const rules = require('./rules');

/**
 * 取一次本次会话的顾客定位。
 * 失败不抛错：返回 null，由调用方降级为无距离浏览。
 * @returns {Promise<{location: {lat: number, lng: number}|null, denied: boolean, message: string}>}
 */
async function resolveViewerLocation() {
  try {
    const current = await location.getCurrentLocation();
    return { location: { lat: current.lat, lng: current.lng }, denied: false, message: '' };
  } catch (error) {
    const failure = error && error.data ? error.data.locationFailure : '';
    return {
      location: null,
      denied: failure === location.LOCATION_FAILURE.DENIED
        || failure === location.LOCATION_FAILURE.SYSTEM_DENIED,
      message: (error && error.message) || '暂时无法取得位置',
    };
  }
}

/**
 * 取公开集合（列表与地图同源）。
 * @param {object} [params]
 * @param {string} [params.categoryCode] 品类码；空串表示全部
 * @param {{lat: number, lng: number}|null} [params.viewerLocation] 只用于本次距离计算
 * @returns {Promise<{vendors: Array<object>, markers: Array<object>, serverNowMs: number,
 *   snapshotVersion: string, emptyReason: {title: string, description: string}}>}
 */
async function loadVendors({ categoryCode = '', viewerLocation = null } = {}) {
  const response = await publicApi.searchPublicVendors({
    categoryCode: categoryCode || undefined,
    viewerLocation: viewerLocation || undefined,
  });
  const data = (response && response.data) || {};
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const serverNowMs = Number(data.serverNowMs) || Date.now();

  return {
    // 顺序直接采纳服务端结果，这里不排序
    vendors: mapper.toCardModels(rawItems, serverNowMs),
    markers: rules.toMarkers(rawItems),
    serverNowMs,
    snapshotVersion: data.snapshotVersion || '',
    emptyReason: rules.emptyReasonOf({ categoryCode }),
  };
}

module.exports = {
  resolveViewerLocation,
  loadVendors,
  locationHintOf: rules.locationHintOf,
  vendorIdAt: rules.vendorIdAt,
};

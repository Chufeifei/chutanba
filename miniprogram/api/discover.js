const { get, post } = require('../utils/request');

/**
 * 顾客发现列表。
 *
 * 位置筛选参数（可选）：
 * - regionId：按摊主当前公开位置所属区域过滤，不需要顾客位置。
 * - lat / lng / radiusM：按顾客本次位置做半径筛选，单位为米，边界含端点；
 *   必须三者齐备，服务端不接受「只给半径」的静默忽略。
 *
 * 隐私约束：顾客精确坐标属个人位置信息，服务端拒绝经 GET 查询串接收（会落入访问日志）。
 * 因此带坐标的筛选一律走 POST /api/v2/vendors/search。
 */

/** 仅按区域筛选（不含顾客坐标），走 GET，结果可缓存。 */
function listVendorsByRegion(params = {}) {
  return get('/api/v2/vendors', params);
}

/** 含顾客位置的半径筛选，走 POST body，坐标不进 URL 与访问日志。 */
function searchVendorsByRadius({ lat, lng, radiusM, regionId } = {}) {
  return post('/api/v2/vendors/search', { lat, lng, radiusM, regionId });
}

/** 摊主详情（含商品/图片/位置/出摊天数）。 */
function getVendorDetail(vendorUserId) {
  return get(`/api/v2/vendors/${vendorUserId}`);
}

module.exports = { listVendorsByRegion, searchVendorsByRadius, getVendorDetail };
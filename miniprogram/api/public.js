/**
 * 顾客公开接口（契约 §5.1）。
 *
 * 无身份也可调用；但"公开"不等于"随便传参"：
 * - 一期禁止 regionId / radiusM（需求 R-06、技术设计 §5），这里不接受这两个参数；
 * - 顾客坐标只能放在请求体（POST），不进 URL，避免落入访问日志。
 */
const { get, post } = require('../utils/request');
const { PUBLIC } = require('../config/endpoints');
const { writePost } = require('./core-v2');

/** 一期可用品类字典。客户端显示名不是筛选依据，服务端会校验品类码。 */
function listCategories() {
  return get(PUBLIC.CATEGORIES);
}

/**
 * 当前公开集合（列表与地图同源）。
 * @param {object} params
 * @param {string} [params.categoryCode] 品类筛选
 * @param {{lat:number,lng:number}} [params.viewerLocation] 仅用于本次距离计算
 */
function searchPublicVendors({ categoryCode, viewerLocation } = {}) {
  return post(PUBLIC.VENDOR_SEARCH, { categoryCode, viewerLocation });
}

/** 公开详情：availability 为 OPEN / RESTING / UNVIEWABLE。 */
function getPublicVendorDetail(vendorId) {
  return get(PUBLIC.VENDOR_DETAIL(vendorId));
}

/** 详情展示后建立平台观察事实，后续现场反馈必须引用它。 */
function createObservation(vendorId, { source, sessionId, locationVersionId } = {}, options) {
  return writePost(PUBLIC.VENDOR_OBSERVATIONS(vendorId), {
    source,
    sessionId,
    locationVersionId,
  }, options);
}

/** 导航前在线复核：准备收摊时返回 CONFIRM_REQUIRED，确认后需再复核一次。 */
function checkNavigation(vendorId, { expectedSessionId, expectedLocationVersionId, confirmPrepared } = {}, options) {
  return writePost(PUBLIC.NAVIGATION_CHECK(vendorId), {
    expectedSessionId,
    expectedLocationVersionId,
    confirmPrepared,
  }, options);
}

/** 最后一步：只有这里返回的坐标才能交给 wx.openLocation。 */
function launchNavigation({ navigationCheckId } = {}, options) {
  return writePost(PUBLIC.NAVIGATION_LAUNCHES, { navigationCheckId }, options);
}

module.exports = {
  listCategories,
  searchPublicVendors,
  getPublicVendorDetail,
  createObservation,
  checkNavigation,
  launchNavigation,
};

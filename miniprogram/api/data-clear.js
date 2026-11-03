/**
 * 本人资料处理（契约 §5.3）。
 *
 * P12 必须先看预览再提交：预览会列明"清除后仍依法保留的最小记录"，
 * 让本人知道"已隐藏"不等于"已删除"。请求成立即生效，不以管理员受理为前提。
 */
const { get } = require('../utils/request');
const { ME } = require('../config/endpoints');
const { writePost } = require('./core-v2');

/** scope = ACCOUNT_DATA / VENDOR_DATA / ALL。预览不是执行。 */
function previewDataClear({ scope } = {}) {
  return get(ME.DATA_CLEAR_PREVIEW, { scope });
}

/**
 * 提交清除请求。
 * 涉及当前公开资料时服务端会先停止公开并结束本轮，客户端不要自己先调"停止公开"。
 */
function createDataClearRequest({ scope, expectedAccountVersion } = {}, options) {
  return writePost(ME.DATA_CLEAR_REQUESTS, { scope, expectedAccountVersion }, options);
}

function listDataClearRequests({ cursor, limit } = {}) {
  return get(ME.DATA_CLEAR_REQUESTS, { cursor, limit });
}

function getDataClearRequest(requestId) {
  return get(ME.DATA_CLEAR_REQUEST_DETAIL(requestId));
}

module.exports = {
  previewDataClear,
  createDataClearRequest,
  listDataClearRequests,
  getDataClearRequest,
};

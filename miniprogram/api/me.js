/**
 * 本人账号与共用命令（契约 §5.2）。
 *
 * GET /me 是本人在整个小程序里的唯一资格来源：
 * 账号可识别性、摊主申请状态、两类公开限制、capabilities 都从这里出。
 * 页面不要自己拼"有 vendorId 所以是摊主"这类推断。
 */
const { get } = require('../utils/request');
const { ME } = require('../config/endpoints');
const { writePost } = require('./core-v2');

/** 本人快照。accountId / capabilities / stateVersion 均由服务端决定。 */
function getMe() {
  return get(ME.PROFILE);
}

/**
 * 申请一次性定位上下文。
 * purpose = OPEN（开摊）/ REFRESH（刷新位置）/ FEEDBACK（现场反馈）。
 * 服务端用签发与接收时刻控制 5 分钟新鲜度，客户端时间不可信。
 */
function createLocationContext({ purpose, targetId } = {}, options) {
  return writePost(ME.LOCATION_CONTEXTS, { purpose, targetId }, options);
}

/**
 * 按原操作键查询写操作结果。
 * 网络超时后必须走这里，而不是换一个新键重新提交 ——
 * 换键会导致服务端认为是第二次意图，可能重复开摊或重复治理。
 */
function queryOperation(operationType, key) {
  return get(ME.OPERATION(operationType, key));
}

module.exports = { getMe, createLocationContext, queryOperation };

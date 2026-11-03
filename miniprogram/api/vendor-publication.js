/**
 * 本人公开控制（契约 §5.2）。
 *
 * 两类限制必须独立：本人停止公开（self）与治理暂停（governance）互不解除。
 * 因此这里没有"恢复全部"这类合并接口，P11 也必须是两个独立信息区。
 * 本人恢复不会自动开摊，也不恢复旧坐标。
 */
const { get } = require('../utils/request');
const { VENDOR } = require('../config/endpoints');
const { writePost } = require('./core-v2');

/** 本人状态：selfStoppedAtMs / governancePausedAtMs 分别给出。 */
function getPublication() {
  return get(VENDOR.PUBLICATION);
}

/** 停止公开：成立即结束本轮、隐藏资料与全部营业位置，并禁止再开摊。 */
function stopPublication({ expectedSelfVersion } = {}, options) {
  return writePost(VENDOR.PUBLICATION_STOP, { expectedSelfVersion }, options);
}

/** 恢复公开：只解除本人限制；资料已清除时服务端返回 PROFILE_REQUIRED。 */
function resumePublication({ expectedSelfVersion } = {}, options) {
  return writePost(VENDOR.PUBLICATION_RESUME, { expectedSelfVersion }, options);
}

module.exports = { getPublication, stopPublication, resumePublication };

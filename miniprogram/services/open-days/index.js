/**
 * 出摊记录域入口（P10）。
 *
 * 页面只 require 本文件。
 *
 * 本页无写业务：只读累计天数与按日记录，不展示历史地图、不显示任何精确坐标。
 * 无摊主行时服务端返回 RESOURCE_NOT_FOUND —— 是「还没申请摊主资料」的空态，不是系统错误。
 */
const sessionApi = require('../../api/vendor-session');
const { BIZ_CODE } = require('../../config/contracts');
const mapper = require('./mapper');

const NO_VENDOR_COPY = Object.freeze({
  title: '还不是摊主',
  description: '提交摊主资料并通过审核后，这里会记录你的出摊天数。',
  actionText: '去申请资料',
});

const NOT_ELIGIBLE_COPY = Object.freeze({
  title: '当前无法查看出摊记录',
  description: '摊主资料已失效或停止，恢复公开后可继续查看。',
});

/**
 * 读一页出摊记录。
 * @param {object} [options]
 * @param {string} [options.cursor] 上一页返回的 nextCursor
 * @param {object} [options.previous] 已有的读模型，传入则把本页追加在后面
 */
async function loadOpenDays({ cursor = '', previous = null } = {}) {
  let response;
  try {
    response = await sessionApi.listOpenDays({ cursor: cursor || undefined });
  } catch (error) {
    if (error && error.bizCode === BIZ_CODE.RESOURCE_NOT_FOUND) {
      return { noVendor: true, notEligible: false, emptyCopy: { ...NO_VENDOR_COPY }, model: null };
    }
    if (error && error.bizCode === BIZ_CODE.NOT_ELIGIBLE) {
      return { noVendor: false, notEligible: true, emptyCopy: { ...NOT_ELIGIBLE_COPY }, model: null };
    }
    throw error;
  }

  const page = mapper.toOpenDaysModel((response && response.data) || {});
  return {
    noVendor: false,
    notEligible: false,
    model: previous ? mapper.appendPage(previous, page) : page,
  };
}

module.exports = {
  NOTICE_TEXT: mapper.NOTICE_TEXT,
  NO_VENDOR_COPY,
  loadOpenDays,
};

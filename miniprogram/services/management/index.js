/**
 * 管理分包编排层入口（一期）。
 *
 * 页面只 require 本文件：首页取入口与队列数据，屏 14 取详情与决定链路。
 * 编排层复用已有 management-* 接口封装与 services/submission，不新增端点。
 */
const contextApi = require('../../api/management-context');
const profileApi = require('../../api/management-profile');
const { tipOf } = require('./common');
const review = require('./profile-review');

/**
 * 首页入口数据与任务列表的真实读取。
 * 队列计数来自管理上下文；任务列表单独读取，读不到时降级为空，不影响入口跳转。
 * @returns {Promise<{ok:boolean, counts?:object, statusText?:string, isEmpty?:boolean, tasks?:Array, tip?:string}>}
 */
async function loadEntryData() {
  try {
    const response = await contextApi.getManagementContext();
    const data = (response && response.data) || {};
    const raw = data.queueCounts || {};
    const counts = {
      profileReviews: Number(raw.profileReviews || 0),
      fieldFeedback: Number(raw.fieldFeedback || 0),
      impactReviews: Number(raw.impactReviews || 0),
    };
    const total = counts.profileReviews + counts.fieldFeedback + counts.impactReviews;
    const tasks = await loadTaskList();
    return {
      ok: true,
      counts,
      statusText: total > 0 ? `${total} 项待处理` : '暂无待处理',
      isEmpty: total === 0 && tasks.length === 0,
      tasks,
    };
  } catch (error) {
    return { ok: false, tip: tipOf(error) };
  }
}

/** 任务列表读取失败只影响列表本身，入口数据照常可用。 */
async function loadTaskList() {
  try {
    const response = await profileApi.listProfileReviews({ status: 'PENDING', limit: '3' });
    const rows = (response && response.data && response.data.rows) || [];
    return rows.map((row) => ({
      id: String(row.submissionId),
      name: row.candidateName || '待审申请',
    }));
  } catch (error) {
    return [];
  }
}

module.exports = {
  loadEntryData,
  loadReviewDetail: review.loadReviewDetail,
  submitDecision: review.submitDecision,
  queryDecisionOutcome: review.queryDecisionOutcome,
};

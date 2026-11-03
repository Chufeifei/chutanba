/**
 * P06 反馈结果。
 *
 * 两个入口共用同一个渲染：刚提交完（参数来自提交响应）与从记录进入（参数只有 id）。
 * 有 id 时以服务端读模型为准 —— 提交那一刻的"待处理"可能已经被人工核实，
 * 页面不能拿提交时的快照继续显示。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');
const { toViewState } = require('../../utils/failure');
const feedback = require('../../services/feedback');

Page({
  data: {
    viewState: createViewState(VIEW_STATE.LOADING),
    showContent: false,
    result: null,
    fromSubmit: false,
  },

  async onLoad(query) {
    const feedbackId = String((query && query.feedbackId) || '').trim();
    const fromSubmit = Boolean(query && query.status);
    this.setData({ fromSubmit });

    // 先用手上的提交结果即时渲染（避免白屏），有 id 再向服务端确认最新状态
    if (fromSubmit) {
      this.applyResult(feedback.toResultModel({
        status: query.status,
        submittedAtMs: Number(query.submittedAtMs) || Date.now(),
        merged: String(query.merged) === '1',
      }));
    }

    if (!feedbackId) {
      if (!fromSubmit) {
        this.setData({
          viewState: createViewState(VIEW_STATE.TERMINAL_ERROR, { description: '缺少反馈标识' }),
        });
      }
      return;
    }

    try {
      const result = await feedback.loadRecordDetail(feedbackId);
      this.applyResult({
        ...result,
        title: result.title,
        description: result.description,
      });
    } catch (error) {
      // 已经有提交结果时保留它，只把"无法刷新"表达出来，不要变成白屏
      if (!fromSubmit) this.setData({ showContent: false, viewState: toViewState(error) });
    }
  },

  applyResult(result) {
    this.setData({
      result,
      showContent: true,
      viewState: createViewState(VIEW_STATE.CONTENT),
    });
  },

  onOpenRecords() {
    wx.redirectTo({ url: '/pages/feedback-candidates/index' });
  },

  onStateAction() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.redirectTo({ url: '/pages/discover/index' });
  },
});

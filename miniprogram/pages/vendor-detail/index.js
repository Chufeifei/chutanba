/**
 * P02 摊主详情。
 *
 * 三个分支决定页面长相（页面方案 §3.1）：OPEN 可导航可反馈；RESTING 只展示资料，
 * 不渲染坐标区、距离与导航入口；UNVIEWABLE 只给提示，不展示资料字段。
 * 导航编排在 services/navigation，本页只把结论变成弹层与提示（C-02.5 / AC-06 / AC-18）。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');
const { WRITE_OUTCOME } = require('../../utils/failure');
const { AVAILABILITY } = require('../../config/contracts');
const timing = require('../../config/timing');
const detailService = require('../../services/detail');
const navigation = require('../../services/navigation');
const liveRefresh = require('../../behaviors/live-refresh');

Page({
  behaviors: [liveRefresh],

  data: {
    viewState: createViewState(VIEW_STATE.LOADING),
    detail: null,
    showContent: false,
    isOpen: false,
    // 同步失败标记：为真时禁用导航并提示"状态未更新"
    syncStale: false,
    navBusy: false,
    confirmVisible: false,
    confirmSheet: { title: '', description: '', confirmText: '继续导航', cancelText: '暂不前往' },
    feedbackBusy: false,
  },

  onLoad(query) {
    // 页面参数来自 navigateTo，全是字符串且可能被篡改，必须先校验
    const vendorId = String((query && query.vendorId) || '').trim();
    this._vendorId = vendorId;
    if (!vendorId) {
      this.setData({
        viewState: createViewState(VIEW_STATE.TERMINAL_ERROR, { description: '缺少摊位标识，请返回重新进入' }),
      });
      return;
    }
    this.setupLiveRefresh({
      fetcher: () => detailService.loadDetail(vendorId),
      intervalMs: timing.PUBLIC_POLL_MS,
      onResult: (detail) => this.applyDetail(detail),
      onFailure: (viewState) => this.applyFailure(viewState),
    });
  },

  applyDetail(detail) {
    if (detail.availability === AVAILABILITY.UNVIEWABLE) {
      // 本人停止或治理暂停：不给资料快照，避免"不可查看"退化成"资料只读"
      this.setData({
        detail,
        showContent: false,
        isOpen: false,
        syncStale: false,
        viewState: createViewState(VIEW_STATE.TERMINAL_ERROR, { title: '当前不可查看', description: detail.notice }),
      });
      return;
    }
    this.setData({
      detail,
      showContent: true,
      isOpen: detail.availability === AVAILABILITY.OPEN,
      syncStale: false,
      viewState: createViewState(VIEW_STATE.CONTENT),
    });
  },

  applyFailure(viewState) {
    this.setData({
      syncStale: Boolean(this.data.detail),
      viewState: this.data.detail ? createViewState(VIEW_STATE.STALE) : viewState,
    });
  },

  async runNavigation(confirmPrepared) {
    const detail = this.data.detail;
    if (!detail || this.data.navBusy) return;
    this.setData({ navBusy: true });
    try {
      const result = await navigation.beginNavigation({
        vendorId: this._vendorId,
        expected: { sessionId: detail.session.sessionId, locationVersionId: detail.session.locationVersionId },
        confirmPrepared,
      });
      this.applyNavigation(result);
    } finally {
      this.setData({ navBusy: false });
    }
  },

  applyNavigation(result) {
    if (result.kind === 'NEED_CONFIRM') {
      this.setData({ confirmVisible: true, confirmSheet: result.sheet });
      return;
    }
    this.setData({ confirmVisible: false });
    if (result.kind === 'BLOCKED') {
      wx.showToast({ title: result.message, icon: 'none' });
      if (result.reload) this.refreshLiveNow();
    }
  },

  onNavigate() {
    if (!this.data.isOpen) return;
    // 状态未更新时禁止发起导航：拿不到新鲜结论就不能按旧页面继续
    if (!this.isLiveFresh()) {
      wx.showToast({ title: '状态未更新，请先重新确认', icon: 'none' });
      return;
    }
    this.runNavigation(false);
  },

  onConfirmCancel() {
    this.setData({ confirmVisible: false });
  },

  onConfirmContinue() {
    // 弹层停留期间轮次或位置可能已变：必须换新意图重新复核，不能复用上次结论
    this.runNavigation(true);
  },

  async onFeedback() {
    const detail = this.data.detail;
    if (!detail || !this.data.isOpen || this.data.feedbackBusy) return;
    this.setData({ feedbackBusy: true });
    try {
      const result = await detailService.createFeedbackObservation({
        vendorId: this._vendorId,
        sessionId: detail.session.sessionId,
        locationVersionId: detail.session.locationVersionId,
      });
      if (result.outcome !== WRITE_OUTCOME.SUCCEEDED) {
        wx.showToast({ title: result.message || '暂时无法进入反馈', icon: 'none' });
        return;
      }
      const data = result.data || {};
      const token = data.claimToken ? `&claimToken=${encodeURIComponent(data.claimToken)}` : '';
      wx.navigateTo({ url: `/pages/feedback-form/index?observationId=${data.observationId}${token}` });
    } finally {
      this.setData({ feedbackBusy: false });
    }
  },

  onStateAction() {
    this.refreshLiveNow();
  },
});

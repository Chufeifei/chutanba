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
const branchStates = require('../../mock/branch-states');

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
    navReviewFailure: false,
    navReviewMessage: '',
    confirmVisible: false,
    confirmSheet: { title: '', description: '', confirmText: '继续导航', cancelText: '暂不前往' },
    feedbackBusy: false,
  },

  onLoad(query) {
    // 页面参数来自 navigateTo，全是字符串且可能被篡改，必须先校验
    const vendorId = String((query && query.vendorId) || '').trim();
    this._vendorId = vendorId;
    this._failureKind = 'UNKNOWN';
    // 列表导航小按钮带 intent=navigate：详情就绪后直接发起本次复核
    this._autoNavigate = String((query && query.intent) || '') === 'navigate';
    if (!vendorId) {
      this.setData({
        viewState: createViewState(VIEW_STATE.TERMINAL_ERROR, { description: '缺少摊位标识，请返回重新进入' }),
      });
      return;
    }
    this.setupLiveRefresh({
      fetcher: () => detailService.loadDetail(vendorId).catch((error) => {
        // 错误进入时统一归一成 kind，失败判定只读分类结果，不再散落比较字段
        this._failureKind = branchStates.resolveFailureKind(error);
        throw error;
      }),
      intervalMs: timing.PUBLIC_POLL_MS,
      onResult: (detail) => this.applyDetail(detail),
      onFailure: (viewState) => this.applyFailure(viewState),
    });
  },

  applyDetail(detail) {
    const autoNavigate = this._autoNavigate;
    this._autoNavigate = false;
    if (detail.availability === AVAILABILITY.UNVIEWABLE) {
      // 本人停止或治理暂停：不给资料快照，避免"不可查看"退化成"资料只读"
      this.setData({
        detail,
        showContent: false,
        isOpen: false,
        syncStale: false,
        navReviewFailure: false,
        navReviewMessage: '',
        viewState: createViewState(VIEW_STATE.TERMINAL_ERROR, { title: '当前不可查看', description: detail.notice }),
      });
      return;
    }
    this.setData({
      detail,
      showContent: true,
      isOpen: detail.availability === AVAILABILITY.OPEN,
      syncStale: false,
      navReviewFailure: false,
      navReviewMessage: '',
      viewState: createViewState(VIEW_STATE.CONTENT),
    });
    // 从列表导航入口进入：详情就绪且仍在营业时，按同一复核链路发起本次导航
    if (autoNavigate && this.data.isOpen) this.onNavigate();
  },

  applyFailure(viewState) {
    // 统一分类结果 stateKey === 'viewState' 时按整页/stale 置位，语义不变
    const stateKey = branchStates.stateKeyOfKind(this._failureKind);
    this.setData({
      syncStale: Boolean(this.data.detail),
      viewState: stateKey === 'viewState'
        ? (this.data.detail
          ? createViewState(VIEW_STATE.STALE, { title: '状态未更新', description: '状态未更新' })
          : viewState)
        : viewState,
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
    // 统一分类：把导航结论归一成标准 kind，19 分支态由分类结果（stateKey）驱动，
    // 不再直接对服务返回的原始字符串做失败判定
    const kind = branchStates.resolveFailureKind({ data: { kind: result.kind } });
    // 与 applyFailure 链路共用同一分类字段，屏 19 失败判定与整页失败同源
    this._failureKind = kind;
    const stateKey = branchStates.stateKeyOfKind(this._failureKind);
    if (result.kind === 'NEED_CONFIRM') {
      this.setData({ confirmVisible: true, confirmSheet: result.sheet, navReviewFailure: false, navReviewMessage: '' });
      return;
    }
    this.setData({ confirmVisible: false });
    if (stateKey === 'navReviewFailure') {
      // 失败原因只取第一个短句：长规则解释压到 ≤12 字，别整句丢掉
      const message = String(result.message || '复核未通过').split(/[，。；、]/)[0];
      this.setData({
        navReviewFailure: true,
        navReviewMessage: message.length > 12 ? message.slice(0, 12) : message,
      });
      if (result.reload) this.refreshLiveNow();
      return;
    }
    this.setData({ navReviewFailure: false, navReviewMessage: '' });
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

  onRetryReview() {
    this._failureKind = 'UNKNOWN';
    this.setData({ navReviewFailure: false, navReviewMessage: '' });
    this.onNavigate();
  },

  onReviewBack() {
    this._failureKind = 'UNKNOWN';
    this.setData({ navReviewFailure: false, navReviewMessage: '' });
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

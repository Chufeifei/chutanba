/**
 * 影响复核（管理分包，屏 18）。
 *
 * 页面只做渲染与事件转发：详情读取、决定提交、结果查询都在
 * services/management/impact-review。决定按钮携带的 taskVersion 取自 GET 详情响应，
 * 写命令统一经 services/submission.runWrite 注入幂等键。
 * 202 / PROCESSING 与结果未知都只按原键轮询，不重发写命令。
 * 返回栏由原生 navigationBar 提供，本页无 TabBar。
 *
 * viewState 六个分支：loading / failed（失败态）/ empty（空态）/
 * content（列表态）/ processing（提交中）/ done（结果态）。
 */
const review = require('../../../services/management/impact-review');

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_TIMES = 20;

Page({
  data: {
    viewState: 'loading',
    tip: review.IMPACT_TIP.LOADING,
    detail: null,
    reason: '',
  },

  onLoad(options) {
    this._reviewId = options && options.id ? String(options.id) : '';
    this._taskVersion = null;
    this._pollTimer = null;
    this._pollTimes = 0;
    this.load();
  },

  onUnload() {
    this.stopPoll();
  },

  /** 详情读取：失败态 / 空态 / 列表态。 */
  async load() {
    this.stopPoll();
    this.setData({
      viewState: 'loading',
      tip: review.IMPACT_TIP.LOADING,
      detail: null,
      reason: '',
    });
    const result = await review.loadImpactReviewDetail(this._reviewId);
    if (!result.ok) {
      this.setData({ viewState: 'failed', tip: result.tip });
      return;
    }
    if (result.empty) {
      this.setData({ viewState: 'empty', tip: review.IMPACT_TIP.EMPTY });
      return;
    }
    this._reviewId = result.model.reviewId;
    this._taskVersion = result.model.taskVersion;
    this.setData({ viewState: 'content', detail: result.model, tip: '' });
  },

  onReasonInput(event) {
    this.setData({ reason: event.detail.value });
  },

  onApproveTap(event) {
    this.submit(review.IMPACT_DECISION.REVOKED, event);
  },

  onRejectTap(event) {
    this.submit(review.IMPACT_DECISION.UPHELD, event);
  },

  /** 决定按钮：版本来自按钮绑定的详情字段，写命令经编排层 runWrite。 */
  async submit(decision, event) {
    if (!this._reviewId || !this.data.detail) return;
    const raw = event && event.currentTarget ? event.currentTarget.dataset.version : undefined;
    const version = typeof this._taskVersion === 'number' ? this._taskVersion : Number(raw);
    const reason = this.data.reason;
    if (!reason || !String(reason).trim()) {
      this.setData({ tip: '请填写处理原因' });
      return;
    }
    if (!Number.isSafeInteger(version)) {
      this.setData({ tip: '状态已变化，请重新进入' });
      this.load();
      return;
    }
    this.setData({ viewState: 'processing', tip: review.IMPACT_TIP.PROCESSING });
    let view;
    try {
      view = await review.submitImpactReviewDecision({
        reviewId: this._reviewId,
        decision,
        reason,
        expectedTaskVersion: version,
      });
    } catch (error) {
      view = { kind: 'failed', message: review.IMPACT_TIP.FAIL };
    }
    this.applyDecisionView(view);
    if (view && view.kind === 'processing') this.startPoll();
  },

  /** 只把结果落到视图，不在这里启动轮询，避免循环自重启。 */
  applyDecisionView(view) {
    const result = view || { kind: 'failed', message: review.IMPACT_TIP.FAIL };
    if (result.kind === 'processing') {
      this.setData({ viewState: 'processing', tip: result.message });
      return;
    }
    this.setData({ viewState: 'done', tip: result.message });
  },

  /** 提交中按原键轮询：每一轮只调查询，不重新提交。 */
  startPoll() {
    this.stopPoll();
    this._pollTimes = 0;
    const step = async () => {
      if (this.data.viewState !== 'processing') return;
      this._pollTimes += 1;
      let view;
      try {
        view = await review.queryImpactReviewOutcome();
      } catch (error) {
        view = { kind: 'processing', message: review.IMPACT_TIP.PROCESSING };
      }
      if (this.data.viewState !== 'processing') return;
      if (view.kind === 'processing' && this._pollTimes < POLL_MAX_TIMES) {
        this._pollTimer = setTimeout(step, POLL_INTERVAL_MS);
        return;
      }
      if (view.kind === 'processing') {
        this.setData({ tip: '处理时间较长，请稍后查看' });
        return;
      }
      this.setData({ viewState: 'done', tip: view.message });
    };
    this._pollTimer = setTimeout(step, POLL_INTERVAL_MS);
  },

  stopPoll() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  },

  /** 提交中手动查看最新结果：仍按原键查询，不重发。 */
  async onQueryTap() {
    if (this.data.viewState !== 'processing') return;
    let view;
    try {
      view = await review.queryImpactReviewOutcome();
    } catch (error) {
      view = { kind: 'processing', message: review.IMPACT_TIP.PROCESSING };
    }
    this.applyDecisionView(view);
    if (view && view.kind === 'processing') this.startPoll();
  },

  onReloadTap() {
    this.load();
  },

  onBackTap() {
    this.load();
  },
});

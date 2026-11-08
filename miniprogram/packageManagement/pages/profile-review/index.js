/**
 * 管理分包资料审核（屏 14）。
 *
 * 详情与决定链路经 services/management 编排层：版本基准取详情响应的 taskVersion，
 * 决定按 202 在途、成功、失败分别处理；在途期间按原操作键查询结果，不重新提交。
 */
const management = require('../../../services/management');

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_TIMES = 20;

Page({
  data: {
    viewState: 'loading',
    detail: null,
    reason: '',
    tip: '',
    notice: '',
    processing: false,
    done: false,
    busy: false,
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

  onReloadTap() {
    this.load();
  },

  onReasonInput(event) {
    this.setData({ reason: event.detail.value });
  },

  onApproveTap(event) {
    this.submit('APPROVE', event);
  },

  onRejectTap(event) {
    this.submit('REJECT', event);
  },

  async load() {
    this.stopPoll();
    this.setData({
      viewState: 'loading',
      tip: '',
      notice: '',
      processing: false,
      done: false,
      busy: false,
    });
    const result = await management.loadReviewDetail(this._reviewId);
    if (!result.ok) {
      this.setData({ viewState: 'failed', tip: result.tip || '暂时未能完成' });
      return;
    }
    if (result.empty) {
      this.setData({ viewState: 'empty' });
      return;
    }
    this._reviewId = result.model.reviewId;
    this._taskVersion = result.model.taskVersion;
    this.setData({ viewState: 'content', detail: result.model });
  },

  async submit(decision, event) {
    if (this.data.busy || this.data.processing || this.data.done) return;
    const raw = event && event.currentTarget ? event.currentTarget.dataset.version : undefined;
    const version = typeof this._taskVersion === 'number' ? this._taskVersion : Number(raw);
    if (!Number.isSafeInteger(version)) {
      this.setData({ notice: '请稍候重试' });
      this.load();
      return;
    }
    this.setData({ busy: true, notice: '' });
    try {
      const view = await management.submitDecision({
        reviewId: this._reviewId,
        decision,
        reason: this.data.reason,
        expectedTaskVersion: version,
      });
      this.applyDecisionView(view);
    } catch (error) {
      this.setData({ busy: false, notice: '暂时未能完成' });
    }
  },

  applyDecisionView(view) {
    if (view.kind === 'processing') {
      this.setData({ busy: false, processing: true, notice: view.message });
      this.startPoll();
      return;
    }
    if (view.kind === 'succeeded') {
      this.setData({ busy: false, done: true, processing: false, notice: '' });
      wx.showToast({ title: view.message, icon: 'none' });
      return;
    }
    this.setData({ busy: false, processing: false, notice: view.message });
  },

  startPoll() {
    this.stopPoll();
    this._pollTimes = 0;
    const step = async () => {
      if (!this.data.processing) return;
      this._pollTimes += 1;
      let view;
      try {
        view = await management.queryDecisionOutcome();
      } catch (error) {
        view = { kind: 'processing', message: '正在处理，请稍候' };
      }
      if (!this.data.processing) return;
      if (view.kind === 'processing' && this._pollTimes < POLL_MAX_TIMES) {
        this._pollTimer = setTimeout(step, POLL_INTERVAL_MS);
        return;
      }
      this.setData({ processing: false });
      if (view.kind === 'succeeded') {
        this.setData({ done: true, notice: '' });
        wx.showToast({ title: view.message, icon: 'none' });
      } else if (view.kind === 'processing') {
        this.setData({ notice: '处理时间较长，请稍后查看' });
      } else {
        this.setData({ notice: view.message });
      }
    };
    this._pollTimer = setTimeout(step, POLL_INTERVAL_MS);
  },

  stopPoll() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  },
});

/**
 * 治理处理（管理分包）。
 *
 * 页面只做渲染与事件转发：读取、决定提交、结果查询都在 services/management/governance。
 * 决定按钮携带的 expectedGovernanceVersion 取自 GET 详情响应的 governanceVersion，
 * 写命令统一经 services/submission.runWrite 注入幂等键。
 * 202 / PROCESSING 与结果未知都只按原键轮询 queryDecisionOutcome，不重发写命令。
 *
 * viewState 六个分支：loading / failed（失败态）/ empty（空态）/
 * content（列表态）/ processing（提交中）/ done（结果态）。
 */
const governance = require('../../../services/management/governance');

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_TIMES = 20;

Page({
  data: {
    viewState: 'loading',
    tip: governance.TIP.LOADING,
    vendors: [],
    detail: null,
    reason: '',
  },

  onLoad(options) {
    this._vendorId = options && options.vendorId ? String(options.vendorId) : '';
    this._action = '';
    this._pollTimer = null;
    this._pollTimes = 0;
    this.load();
  },

  onUnload() {
    this.stopPoll();
  },

  /** 列表读取：失败态 / 空态 / 列表态，并载入选中对象的详情。 */
  async load() {
    this.stopPoll();
    this.setData({
      viewState: 'loading',
      tip: governance.TIP.LOADING,
      vendors: [],
      detail: null,
      reason: '',
    });
    const result = await governance.loadGovernanceVendors();
    if (!result.ok) {
      this.setData({ viewState: 'failed', tip: result.tip });
      return;
    }
    if (!result.vendors.length) {
      this.setData({ viewState: 'empty', tip: governance.TIP.EMPTY });
      return;
    }
    const vendors = result.vendors;
    this.setData({ viewState: 'content', vendors, tip: '' });
    const target = this._vendorId || vendors[0].vendorId;
    this.loadDetail(target);
  },

  /** 详情读取：版本字段随模型回传，供决定按钮绑定。 */
  async loadDetail(vendorId) {
    const result = await governance.loadGovernanceDetail(vendorId);
    if (!result.ok) {
      this.setData({ tip: result.tip });
      return;
    }
    if (result.empty) {
      this.setData({ tip: governance.TIP.EMPTY });
      return;
    }
    this._vendorId = vendorId;
    this.setData({ detail: result.model, reason: '', tip: '' });
  },

  onVendorTap(event) {
    this.loadDetail(event.currentTarget.dataset.vendorId);
  },

  onReasonInput(event) {
    this.setData({ reason: event.detail.value });
  },

  /** 决定按钮：版本来自按钮绑定的详情字段，写命令经编排层 runWrite。 */
  async onDecideTap(event) {
    const dataset = event.currentTarget.dataset || {};
    const action = dataset.action;
    const version = Number(dataset.version);
    const reason = this.data.reason;
    const vendorId = this._vendorId;
    if (!vendorId || !this.data.detail) return;
    if (!reason || !String(reason).trim()) {
      this.setData({ tip: '请填写处理原因' });
      return;
    }
    this._action = action;
    this.setData({ viewState: 'processing', tip: governance.TIP.PROCESSING });
    let view;
    try {
      view = await governance.submitDecision({
        vendorId, action, reason, expectedGovernanceVersion: version,
      });
    } catch (error) {
      view = { kind: 'failed', message: governance.TIP.FAIL };
    }
    this.applyDecisionView(view);
    if (view && view.kind === 'processing') this.startPoll();
  },

  /** 只把结果落到视图，不在这里启动轮询，避免循环自重启。 */
  applyDecisionView(view) {
    const result = view || { kind: 'failed', message: governance.TIP.FAIL };
    if (result.kind === 'processing') {
      this.setData({ viewState: 'processing', tip: result.message });
      return;
    }
    this.setData({ viewState: 'done', tip: result.message });
  },

  /** 提交中按原键轮询：每一轮只调 queryDecisionOutcome，不重新提交。 */
  startPoll() {
    this.stopPoll();
    this._pollTimes = 0;
    const step = async () => {
      if (this.data.viewState !== 'processing') return;
      this._pollTimes += 1;
      let view;
      try {
        view = await governance.queryDecisionOutcome(this._action);
      } catch (error) {
        view = { kind: 'processing', message: governance.TIP.PROCESSING };
      }
      if (this.data.viewState !== 'processing') return;
      if (view.kind === 'processing' && this._pollTimes < POLL_MAX_TIMES) {
        this._pollTimer = setTimeout(step, POLL_INTERVAL_MS);
        return;
      }
      if (view.kind === 'processing') {
        this.setData({ viewState: 'processing', tip: '处理时间较长，请稍后查看' });
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
      view = await governance.queryDecisionOutcome(this._action);
    } catch (error) {
      view = { kind: 'processing', message: governance.TIP.PROCESSING };
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

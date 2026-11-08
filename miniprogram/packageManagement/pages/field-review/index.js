/**
 * P16 现场反馈复核：历史事实逐条给结论，当前轮次纠错另作一次独立写。
 * 两个动作各自独立幂等键，结果待确认时按原键查询，不重发。
 */
const { VIEW_STATE, createViewState } = require('../../../utils/view-state');
const fieldReview = require('../../../services/management/field-review');

const STATE_TYPE = Object.freeze({
  empty: VIEW_STATE.EMPTY,
  permission: VIEW_STATE.PERMISSION,
  retryable: VIEW_STATE.RETRYABLE_ERROR,
  terminal: VIEW_STATE.TERMINAL_ERROR,
});

const POLL_GAP_MS = 1500;
const POLL_LIMIT = 3;

Page({
  data: {
    viewState: createViewState(VIEW_STATE.LOADING, { description: '' }),
    showContent: false,
    detail: null,
    facts: [],
    reason: '',
    notice: '',
    busy: false,
    pendingAction: '',
    missingCase: false,
  },

  onLoad(query) {
    this._caseId = String((query && (query.caseId || query.id)) || '').trim();
    this._pollTimer = null;
    this._querying = false;
    this.load();
  },

  onUnload() {
    this.stopPolling();
  },

  /** 加载中 / 空 / 无权 / 失败由状态视图呈现，内容态由页面渲染。 */
  async load() {
    this.stopPolling();
    this.setData({
      showContent: false,
      viewState: createViewState(VIEW_STATE.LOADING, { description: '' }),
      notice: '',
      pendingAction: '',
      missingCase: false,
    });
    const result = await fieldReview.loadCase(this._caseId);
    if (!result.ok) {
      if (result.empty || !this._caseId) {
        // 入口未带事项编号：可辨识空态 + 返回入口，不重试、不卡加载态
        this.setData({
          viewState: createViewState(VIEW_STATE.EMPTY, {
            title: result.text || '缺少事项编号',
            description: '请从管理首页进入现场复核',
          }),
          missingCase: true,
        });
        return;
      }
      this.setData({
        viewState: createViewState(STATE_TYPE[result.state] || VIEW_STATE.TERMINAL_ERROR, {
          title: result.text,
          description: '',
        }),
      });
      return;
    }
    this.setData({
      showContent: true,
      viewState: createViewState(VIEW_STATE.CONTENT),
      detail: result.model,
      facts: result.model.facts,
    });
  },

  onStateAction() {
    if (this.data.missingCase) {
      this.onBack();
      return;
    }
    this.load();
  },

  /** 返回管理分包首页这个唯一入口；从旧链接直接进入时也能退回。 */
  onBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.redirectTo({ url: '/packageManagement/pages/index/index' });
    }
  },

  /** 每条事实独立可选结论，不设整体二态。 */
  onFactResultTap(event) {
    const { factId, result } = event.currentTarget.dataset;
    const facts = this.data.facts.map((item) => (
      item.factId === String(factId) ? { ...item, result } : item
    ));
    this.setData({ facts });
  },

  onReasonInput(event) {
    this.setData({ reason: event.detail.value });
  },

  /** 动作一：逐事实核实，独立写。 */
  async onDecisionTap() {
    if (this.data.busy || this.data.pendingAction) return;
    if (!this.data.facts.length) {
      wx.showToast({ title: '暂无可处理事实', icon: 'none' });
      return;
    }
    if (this.data.facts.some((item) => !item.result)) {
      wx.showToast({ title: '请先选择每条事实结论', icon: 'none' });
      return;
    }
    this.setData({ busy: true, notice: '' });
    try {
      const outcome = await fieldReview.submitDecision(this.data.facts);
      this.applyWriteResult('decision', outcome);
    } finally {
      this.setData({ busy: false });
    }
  },

  /** 动作二：纠正当前轮次，独立写。 */
  async onCorrectionTap() {
    if (this.data.busy || this.data.pendingAction) return;
    if (!this.data.reason.trim()) {
      wx.showToast({ title: '请填写当前异常依据', icon: 'none' });
      return;
    }
    this.setData({ busy: true, notice: '' });
    try {
      const outcome = await fieldReview.submitCorrection(this.data.reason);
      this.applyWriteResult('correction', outcome);
    } finally {
      this.setData({ busy: false });
    }
  },

  applyWriteResult(action, outcome) {
    const notice = fieldReview.toWriteNotice(outcome);
    if (notice.kind === 'pending') {
      this.setData({ notice: notice.text, pendingAction: action });
      this.startPolling(action);
      return;
    }
    this.setData({ notice: notice.text, pendingAction: '' });
  },

  /** 202 或结果未知：按原键轮询查询，不重发写。 */
  startPolling(action) {
    this.stopPolling();
    let left = POLL_LIMIT;
    const tick = async () => {
      if (!this.data.pendingAction) return;
      const result = await fieldReview.queryOutcomeOf(action);
      if (result.kind === 'succeeded') {
        this.stopPolling();
        this.setData({ pendingAction: '', notice: '已提交' });
        return;
      }
      if (result.kind === 'failed') {
        this.stopPolling();
        this.setData({ pendingAction: '', notice: '操作未成立' });
        return;
      }
      left -= 1;
      if (left > 0) {
        this._pollTimer = setTimeout(tick, POLL_GAP_MS);
      } else {
        this.setData({ notice: '仍在处理中' });
      }
    };
    this._pollTimer = setTimeout(tick, POLL_GAP_MS);
  },

  stopPolling() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  },

  /** 轮询期间也可手动查看最新结果，仍走同一个原键查询。 */
  async onQueryOutcome() {
    const action = this.data.pendingAction;
    if (!action || this._querying) return;
    this._querying = true;
    try {
      const result = await fieldReview.queryOutcomeOf(action);
      if (result.kind === 'succeeded') {
        this.stopPolling();
        this.setData({ pendingAction: '', notice: '已提交' });
      } else if (result.kind === 'failed') {
        this.stopPolling();
        this.setData({ pendingAction: '', notice: '操作未成立' });
      } else {
        wx.showToast({ title: '仍在处理中', icon: 'none' });
      }
    } finally {
      this._querying = false;
    }
  },
});

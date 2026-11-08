/**
 * P09 摊主工作台。
 *
 * 阶段与剩余只取服务端下发值；「最后成功定位时间」与「前台同步时间」分开显示；
 * 本人停止公开与治理暂停分别显示，互不解除。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');
const { WRITE_OUTCOME } = require('../../utils/failure');
const timing = require('../../config/timing');
const workbench = require('../../services/workbench');
const liveRefresh = require('../../behaviors/live-refresh');
const formSubmit = require('../../behaviors/form-submit');

const ACTION = workbench.ACTION;

Page({
  behaviors: [liveRefresh, formSubmit],

  data: {
    viewState: createViewState(VIEW_STATE.LOADING),
    showContent: false,
    noVendor: false,
    canOpen: false,
    canOperate: false,
    model: null,
    cutoffOptions: [],
    cutoffIndex: 0,
    locationName: workbench.DEFAULT_LOCATION_NAME,
    syncedText: '',
    confirmVisible: false,
    confirmSheet: { title: '', description: '', confirmText: '确认' },
    unknownVisible: false,
    // 09 → 10 的时间确认视图开关：仅控制开摊前的整屏状态，与 isOpen 无关
    confirmingTime: false,
  },

  onLoad() {
    this.setupLiveRefresh({
      fetcher: () => workbench.loadWorkbench({ keepAtMs: this._cutoffAtMs }),
      intervalMs: timing.WORKBENCH_POLL_MS,
      onResult: (result) => this.applyWorkbench(result),
      onFailure: (viewState, meta) => this.applyFailure(viewState, meta),
    });
  },

  applyWorkbench(result) {
    if (!result) return;
    this._stateVersion = result.stateVersion || 0;
    this.setData(workbench.toViewPayload(result));
  },

  applyFailure(viewState, meta) {
    this.setData(workbench.toFailurePayload(viewState, Boolean(meta && meta.hadData)));
  },

  onStateAction() {
    if (this.data.noVendor) {
      wx.navigateTo({ url: '/pages/vendor-profile/index' });
      return;
    }
    this.refreshLiveNow({ force: true });
  },

  onCutoffChange(event) {
    const index = Number(event.detail.value);
    const option = this.data.cutoffOptions[index];
    if (!option) return;
    this._cutoffAtMs = option.atMs;
    this.setData({ cutoffIndex: index });
  },

  currentCutoffText() {
    const option = this.data.cutoffOptions[this.data.cutoffIndex];
    return option ? option.pickerText : '';
  },

  onLocationNameInput(event) {
    this.setData({ locationName: event.detail.value });
  },

  /** 开摊、刷新、收摊共用一个确认弹层：动作由调用方给出。 */
  openConfirm(action) {
    if (!action || !this.data.model) return;
    this._confirmAction = action;
    this.setData({
      confirmVisible: true,
      confirmSheet: workbench.confirmCopy(action, {
        cutoffText: this.currentCutoffText(),
        locationName: this.data.locationName,
      }),
    });
  },

  /**
   * 命名遗留：primary/secondary 沿用旧 fixed-cta 插槽名，与动作语义不再一一对应。
   * 营业中主按钮「收摊」绑 onSecondaryTap(CLOSE)、次级「刷新位置」绑 onPrimaryTap(REFRESH)；
   * 休息态「一键开摊」先走 onStartConfirmTime，时间确认后由 onConfirmOpenTime 回到本方法(OPEN)。
   */
  onPrimaryTap() {
    this.openConfirm(this.data.model && this.data.model.isOpen ? ACTION.REFRESH : ACTION.OPEN);
  },

  onSecondaryTap() {
    this.openConfirm(ACTION.CLOSE);
  },

  /** 09 一键开摊：先进 10 时间确认视图，不直接弹确认层。 */
  onStartConfirmTime() {
    this.setData({ confirmingTime: true });
  },

  /** 10 返回：放弃时间确认，回到 09。 */
  onCancelConfirmTime() {
    this.setData({ confirmingTime: false });
  },

  /** 10 确认并开摊：收起时间视图后复用原有 OPEN 确认链路（不改 openConfirm / runAction）。 */
  onConfirmOpenTime() {
    this.setData({ confirmingTime: false });
    this.onPrimaryTap();
  },

  onConfirmCancel() { this.setData({ confirmVisible: false }); },

  onConfirmSubmit() {
    const action = this._confirmAction;
    this.setData({ confirmVisible: false });
    this.runAction(action);
  },

  async runAction(action) {
    if (this.isSubmitting()) return;
    // 新的动作开始前先撤掉上一次「结果待确认」的提示与待查动作
    this._pendingAction = '';
    this.setData({ unknownVisible: false });
    const result = await this.runFormSubmit({
      submitter: () => workbench.runAction(action, {
        model: this.data.model,
        cutoff: this.data.cutoffOptions[this.data.cutoffIndex],
        locationName: this.data.locationName,
        stateVersion: this._stateVersion || 0,
      }),
      onSuccess: () => this.afterSuccess(action),
      onUnknown: () => this.setData({ unknownVisible: true }),
    });
    if (result && result.outcome === WRITE_OUTCOME.UNKNOWN) this._pendingAction = action;
  },

  afterSuccess(action) {
    wx.showToast({ title: workbench.successTip(action), icon: 'none' });
    this.refreshLiveNow({ force: true });
  },

  /** 结果未知时唯一的出口：按原操作键查，成立就刷新，不重新发起。 */
  async onQueryOutcome() {
    const action = this._pendingAction;
    const result = await workbench.queryAction(action);
    if (result.kind === 'succeeded') {
      this.setData({ unknownVisible: false });
      this.afterSuccess(action);
      return;
    }
    if (result.kind === 'failed') {
      this.setData({ unknownVisible: false });
      this.resetSubmitState();
      wx.showToast({ title: '上次操作未成立，可以重新发起', icon: 'none' });
      return;
    }
    wx.showToast({ title: '仍在处理中，请稍后再查', icon: 'none' });
  },
  /** 只读入口统一走 data-url，不在页面里堆跳转方法。 */
  onNavigateTap(event) { wx.navigateTo({ url: event.currentTarget.dataset.url }); },
});

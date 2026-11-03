/**
 * P11 公开与资料处理。
 *
 * 三个独立分区：资料状态、本人公开选择、治理限制。
 * 本人区可操作（停止 / 恢复），治理区只读 —— 合成一个开关等于暗示
 * "解除一个会连带解除另一个"，这是需求 O-03 明令禁止的。
 *
 * 写结果如何解读（含 PROFILE_REQUIRED 的专门引导）在 services/publication，
 * 本页只渲染 message 与两个布尔位。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');
const { toViewState } = require('../../utils/failure');
const publication = require('../../services/publication');

const { ACTION } = publication;

Page({
  data: {
    viewState: createViewState(VIEW_STATE.LOADING),
    showContent: false,
    noVendor: false,
    model: null,
    confirmVisible: false,
    confirmSheet: { title: '', description: '', confirmText: '' },
    pendingAction: '',
    submitPending: false,
    submitMessage: '',
    unknownVisible: false,
  },

  onShow() {
    // 从 P12 清除回来时状态可能已变，必须重新取数而不是复用旧模型
    this.load();
  },

  async load() {
    try {
      const result = await publication.loadPublication();
      if (result.noVendor) {
        this.setData({
          showContent: false,
          noVendor: true,
          model: null,
          viewState: createViewState(VIEW_STATE.EMPTY, result.emptyCopy),
        });
        return;
      }
      this.setData({
        showContent: true,
        noVendor: false,
        model: result.model,
        viewState: createViewState(VIEW_STATE.CONTENT),
      });
    } catch (error) {
      this.setData({ showContent: false, model: null, viewState: toViewState(error) });
    }
  },

  onStateAction() {
    if (this.data.noVendor) {
      wx.navigateTo({ url: '/pages/vendor-profile/index' });
      return;
    }
    this.load();
  },

  onStopTap() {
    this.openConfirm(ACTION.STOP);
  },

  onResumeTap() {
    this.openConfirm(ACTION.RESUME);
  },

  openConfirm(action) {
    const model = this.data.model;
    if (!model) return;
    const allowed = action === ACTION.STOP ? model.self.canStop : model.self.canResume;
    if (!allowed) return;
    this.setData({
      confirmVisible: true,
      confirmSheet: publication.confirmCopy(action),
      pendingAction: action,
      submitMessage: '',
    });
  },

  onConfirmCancel() {
    if (this.data.submitPending) return;
    this.setData({ confirmVisible: false });
  },

  async onConfirmSubmit() {
    const action = this.data.pendingAction;
    if (!action || this.data.submitPending) return;
    this.setData({ submitPending: true, submitMessage: '', unknownVisible: false });
    let result;
    try {
      result = await publication.runAction(action, {
        expectedSelfVersion: this.data.model.selfVersion,
      });
    } catch (error) {
      result = { outcome: 'failed', message: '操作未能完成' };
    }
    this.setData({ submitPending: false, confirmVisible: false });
    const view = publication.toOutcomeView(action, result);
    this.setData({ submitMessage: view.message, unknownVisible: view.unknownVisible });
    if (view.reload) this.load();
  },

  async onQueryOutcome() {
    const action = this.data.pendingAction;
    if (!action) {
      this.setData({ unknownVisible: false });
      return;
    }
    try {
      const result = await publication.queryAction(action);
      if (result.kind === 'succeeded') {
        this.setData({ unknownVisible: false, submitMessage: publication.successTip(action) });
        this.load();
        return;
      }
      if (result.kind === 'failed') {
        this.setData({ unknownVisible: false, submitMessage: '本次操作未成立，可以重新发起。' });
        this.load();
        return;
      }
      this.setData({ submitMessage: '仍在处理中，请稍后再查看。' });
    } catch (error) {
      this.setData({ submitMessage: '查询失败，请稍后重试。' });
    }
  },

  onProfileTap() {
    wx.navigateTo({ url: '/pages/vendor-profile/index' });
  },

  onClearTap() {
    wx.navigateTo({ url: '/pages/data-clear/index' });
  },

  onRecordsTap() {
    wx.navigateTo({ url: '/pages/impact-records/index' });
  },
});

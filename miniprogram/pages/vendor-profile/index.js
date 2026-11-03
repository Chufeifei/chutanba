/**
 * P07 摊主资料。
 *
 * 只读本人资料：当前生效资料、本次待审修改、最近审核结果三块分区。
 * 读模型由 services/profile 整形，本页不判断资料状态、不拼文案。
 *
 * 在 onShow 里取数而不是 onLoad：P08 提交后 navigateBack 回来必须刷新，
 * 而首次进入时 onShow 也会触发一次，不存在重复请求。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');
const { toViewState } = require('../../utils/failure');
const profile = require('../../services/profile');

Page({
  data: {
    viewState: createViewState(VIEW_STATE.LOADING),
    showContent: false,
    model: null,
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const model = await profile.loadProfile();
      this.setData({
        showContent: true,
        model,
        viewState: createViewState(VIEW_STATE.CONTENT),
      });
    } catch (error) {
      this.setData({ showContent: false, model: null, viewState: toViewState(error) });
    }
  },

  onStateAction() {
    this.load();
  },

  onEditTap() {
    if (!this.data.model || !this.data.model.canSubmit) return;
    wx.navigateTo({ url: '/pages/vendor-profile-edit/index' });
  },
});

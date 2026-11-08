/**
 * P04 现场反馈中心。
 *
 * 两组数据都只来自服务端：可反馈的轮次（窗口关闭即消失）与本人已提交记录
 * （按保留规则仍可查）。本页不做"这个还能不能提交"的本地推断 ——
 * 窗口由服务端按主库时刻判定，页面重算只会和服务端打架。
 *
 * 进页先确认身份：反馈是本人数据，身份不可识别时不该先发一轮必然 401 的请求。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');
const { toViewState } = require('../../utils/failure');
const account = require('../../services/account');
const feedback = require('../../services/feedback');

Page({
  data: {
    viewState: createViewState(VIEW_STATE.LOADING),
    showContent: false,
    candidates: [],
    records: [],
    hasCandidates: false,
    hasRecords: false,
  },

  onShow() {
    // 每次回到本页都重取：刚提交过的记录、刚关闭的窗口都要反映出来
    this.loadAll();
  },

  async ensureIdentity() {
    const existing = account.getIdentity();
    if (existing && existing.accountId) return existing;
    return account.refreshIdentity();
  },

  async loadAll() {
    try {
      const identity = await this.ensureIdentity();
      if (!identity) {
        this.setData({ showContent: false, viewState: this.permissionState() });
        return;
      }

      const [candidates, recordPage] = await Promise.all([
        feedback.loadCandidates(),
        feedback.loadMyRecords(),
      ]);
      const hasCandidates = candidates.length > 0;
      const records = recordPage.records;
      const hasRecords = records.length > 0;
      const showContent = hasCandidates || hasRecords;
      this.setData({
        candidates,
        records,
        hasCandidates,
        hasRecords,
        showContent,
        viewState: showContent
          ? createViewState(VIEW_STATE.CONTENT)
          : createViewState(VIEW_STATE.EMPTY, {
            title: '还没有可反馈的营业轮次',
            description: '在摊主详情页点"反馈现场状态"，或稍后再来看看',
          }),
      });
    } catch (error) {
      const viewState = toViewState(error);
      this.setData({
        showContent: false,
        viewState: viewState.type === VIEW_STATE.PERMISSION ? this.permissionState() : viewState,
      });
    }
  },

  permissionState() {
    return createViewState(VIEW_STATE.PERMISSION, {
      title: '登录后可以查看现场反馈',
      description: '请完成登录后再查看',
    });
  },

  onCandidateTap(event) {
    const observationId = event.currentTarget.dataset.id;
    if (!observationId) return;
    wx.navigateTo({ url: `/pages/feedback-form/index?observationId=${encodeURIComponent(observationId)}` });
  },

  onRecordTap(event) {
    const feedbackId = event.currentTarget.dataset.id;
    if (!feedbackId) return;
    wx.navigateTo({ url: `/pages/feedback-result/index?feedbackId=${encodeURIComponent(feedbackId)}` });
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },

  onStateAction() {
    this.loadAll();
  },
});

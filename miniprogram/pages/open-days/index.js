/**
 * P10 出摊记录。
 *
 * 只读页：累计天数 + 按日记录 + 跨日说明，没有任何写业务。
 * 状态判断（无摊主 / 非 ACTIVE / 空记录）全在 services/open-days，
 * 本页只把读模型绑到视图上。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');
const { toViewState } = require('../../utils/failure');
const listPaging = require('../../behaviors/list-paging');
const openDays = require('../../services/open-days');

Page({
  behaviors: [listPaging],

  data: {
    viewState: createViewState(VIEW_STATE.LOADING),
    showContent: false,
    noVendor: false,
    model: null,
    noticeText: openDays.NOTICE_TEXT,
  },

  onLoad() { this.load(); },

  async load() {
    try {
      const result = await openDays.loadOpenDays();
      if (result.noVendor || result.notEligible) {
        this.setData({
          showContent: false,
          noVendor: Boolean(result.noVendor),
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
    // 无摊主的正确去处是申请资料，不是反复重试同一个接口
    if (this.data.noVendor) {
      wx.navigateTo({ url: '/pages/vendor-profile/index' });
      return;
    }
    this.load();
  },

  onLoadMore() {
    return this.loadMorePage({
      nextCursor: this.data.model && this.data.model.nextCursor,
      fetcher: (cursor) => openDays.loadOpenDays({ cursor, previous: this.data.model }),
      onResult: (result) => this.setData({ model: result.model }),
    });
  },
});

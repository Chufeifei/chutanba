/**
 * P12 资料清除。
 *
 * 顺序硬约束：**先看预览再提交**。预览没拿到时提交按钮不可用 ——
 * "清除什么、会不会结束营业、哪些记录要保留、最迟什么时候处理"都必须本人先看到。
 *
 * 切换范围要重新拉预览：不同范围的受影响类别与保留清单都不同，
 * 沿用上一个范围的预览会让本人对范围产生误解。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');
const { toViewState } = require('../../utils/failure');
const listPaging = require('../../behaviors/list-paging');
const dataClear = require('../../services/data-clear');

Page({
  behaviors: [listPaging],

  data: {
    viewState: createViewState(VIEW_STATE.LOADING),
    showContent: false,
    preview: null,
    canSubmit: false,
    blockedText: '',
    scopeOptions: dataClear.SCOPE_OPTIONS,
    scopeIndex: 0,
    requests: null,
    requestsError: false,
    confirmVisible: false,
    confirmSheet: { title: '', description: '', confirmText: '' },
    submitPending: false,
    submitMessage: '',
    unknownVisible: false,
  },

  onLoad() { this.reload(); },

  onStateAction() { this.reload(); },

  reload() {
    this.loadPreview();
    this.loadRequests();
  },

  currentScope() {
    const options = this.data.scopeOptions;
    const option = options[this.data.scopeIndex] || options[0];
    return option.value;
  },

  async loadPreview() {
    try {
      const loaded = await dataClear.loadPreview({ scope: this.currentScope() });
      this.setData({
        showContent: true,
        preview: loaded.model,
        canSubmit: loaded.canSubmit,
        blockedText: loaded.blockedText,
        viewState: createViewState(VIEW_STATE.CONTENT),
      });
    } catch (error) {
      this.setData({
        showContent: false,
        preview: null,
        canSubmit: false,
        viewState: toViewState(error),
      });
    }
  },

  async loadRequests() {
    try {
      const model = await dataClear.loadRequests({});
      this.setData({ requests: model, requestsError: false });
    } catch (error) {
      this.setData({ requests: null, requestsError: true });
    }
  },

  async onScopeChange(event) {
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || index === this.data.scopeIndex) return;
    // 旧预览属于旧范围，必须清掉：留着会让本人以为已看清当前范围
    this.setData({
      scopeIndex: index,
      preview: null,
      canSubmit: false,
      blockedText: '',
      submitMessage: '',
      unknownVisible: false,
    });
    await this.loadPreview();
  },

  onPrimaryTap() {
    if (!this.data.canSubmit || this.data.submitPending) return;
    this.setData({
      confirmVisible: true,
      confirmSheet: dataClear.confirmCopy(this.data.preview),
      submitMessage: '',
    });
  },

  onConfirmCancel() {
    if (this.data.submitPending) return;
    this.setData({ confirmVisible: false });
  },

  async onConfirmSubmit() {
    if (this.data.submitPending) return;
    this.setData({ submitPending: true, submitMessage: '', unknownVisible: false });
    let result;
    try {
      result = await dataClear.submitClear({ scope: this.currentScope() });
    } catch (error) {
      result = { outcome: 'failed', message: '提交未能完成' };
    }
    this.setData({ submitPending: false, confirmVisible: false });
    const view = dataClear.toOutcomeView(result);
    this.setData({ submitMessage: view.message, unknownVisible: view.unknownVisible });
    if (view.reload) this.reload();
  },

  async onQueryOutcome() {
    try {
      const result = await dataClear.queryAction();
      if (result.kind === 'succeeded') {
        this.setData({ unknownVisible: false, submitMessage: dataClear.TIP.SUBMITTED });
        this.loadRequests();
        return;
      }
      if (result.kind === 'failed') {
        this.setData({ unknownVisible: false, submitMessage: '本次提交未成立，可以重新发起。' });
        return;
      }
      this.setData({ submitMessage: '仍在处理中，请稍后再查看。' });
    } catch (error) {
      this.setData({ submitMessage: '查询失败，请稍后重试。' });
    }
  },

  onLoadMore() {
    return this.loadMorePage({
      nextCursor: this.data.requests && this.data.requests.nextCursor,
      fetcher: (cursor) => dataClear.loadRequests({ cursor, previous: this.data.requests }),
      onResult: (next) => this.setData({ requests: next }),
    });
  },
});

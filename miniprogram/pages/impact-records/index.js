/**
 * P13 处理记录与人工复核。
 *
 * 能不能申请复核由 services/impact-record 算好（status / 期限 / 是否已有未结复核），
 * 本页只按 reviewable 决定是否显示入口，不在模板里比较状态字面量。
 *
 * 提出复核不解除任何限制 —— 这句必须出现在页面上，且不能写在折叠区里。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');
const { toViewState } = require('../../utils/failure');
const listPaging = require('../../behaviors/list-paging');
const impactRecord = require('../../services/impact-record');

const EMPTY_FORM = Object.freeze({ reason: '', error: '' });

Page({
  behaviors: [listPaging],

  data: {
    viewState: createViewState(VIEW_STATE.LOADING),
    showContent: false,
    records: null,
    reviews: null,
    noticeText: impactRecord.TIP.NOTICE,
    statementMax: impactRecord.STATEMENT_MAX,
    activeId: '',
    form: { ...EMPTY_FORM },
    submitPending: false,
    submitMessage: '',
    unknownVisible: false,
  },

  onLoad() { this.load(); },

  onStateAction() { this.load(); },

  async load() {
    try {
      const loaded = await impactRecord.loadImpacts();
      this.setData({
        showContent: true,
        records: loaded.records,
        reviews: loaded.reviews,
        viewState: createViewState(VIEW_STATE.CONTENT),
      });
    } catch (error) {
      this.setData({
        showContent: false,
        records: null,
        reviews: null,
        viewState: toViewState(error),
      });
    }
  },

  onStateAction() {
    this.load();
  },

  onReviewTap(event) {
    const id = String(event.currentTarget.dataset.id || '');
    if (!id) return;
    // 再点一次收起，避免误触后无法取消
    if (this.data.activeId === id) {
      this.setData({ activeId: '', form: { ...EMPTY_FORM } });
      return;
    }
    this.setData({
      activeId: id,
      form: { ...EMPTY_FORM },
      submitMessage: '',
      unknownVisible: false,
    });
  },

  onReasonInput(event) {
    this.setData({ 'form.reason': event.detail.value, 'form.error': '' });
  },

  onCancelTap() {
    if (this.data.submitPending) return;
    this.setData({ activeId: '', form: { ...EMPTY_FORM } });
  },

  findRecord(id) {
    const list = (this.data.records && this.data.records.records) || [];
    return list.find((item) => item.impactRecordId === id) || null;
  },

  async onSubmitTap() {
    if (this.data.submitPending) return;
    const record = this.findRecord(this.data.activeId);
    if (!record) return;
    this.setData({ submitPending: true, submitMessage: '', 'form.error': '' });
    let result;
    try {
      result = await impactRecord.submitReview({
        impactRecordId: record.impactRecordId,
        impactVersion: record.impactVersion,
        reason: this.data.form.reason,
      });
    } catch (error) {
      result = { outcome: 'failed', message: '提交未能完成' };
    }
    this.setData({ submitPending: false });
    const view = impactRecord.toOutcomeView(result);
    if (view.formError) {
      this.setData({ 'form.error': view.formError });
      return;
    }
    if (view.kind === 'succeeded') {
      this.setData({ activeId: '', form: { ...EMPTY_FORM } });
    }
    this.setData({ submitMessage: view.message, unknownVisible: view.unknownVisible });
    if (view.reload) this.load();
  },

  async onQueryOutcome() {
    try {
      const result = await impactRecord.queryAction();
      if (result.kind === 'succeeded') {
        this.setData({
          unknownVisible: false,
          submitMessage: impactRecord.TIP.SUBMITTED,
          activeId: '',
          form: { ...EMPTY_FORM },
        });
        this.load();
        return;
      }      if (result.kind === 'failed') {
        this.setData({ unknownVisible: false, submitMessage: '本次申请未成立，可以重新发起。' });
        return;
      }
      this.setData({ submitMessage: '仍在处理中，请稍后再查看。' });
    } catch (error) {
      this.setData({ submitMessage: '查询失败，请稍后重试。' });
    }
  },

  onLoadMore() {
    return this.loadMorePage({
      nextCursor: this.data.records && this.data.records.nextCursor,
      fetcher: (cursor) => impactRecord.loadImpacts({
        cursor,
        previous: this.data.records,
      }),
      onResult: (loaded) => this.setData({ records: loaded.records, reviews: loaded.reviews }),
    });
  },
});

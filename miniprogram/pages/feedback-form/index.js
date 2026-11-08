/**
 * P05 填写现场反馈。写命令只经 services/feedback 域入口；提交状态走 behaviors/form-submit，
 * 因为超时是"结果未知"，显示成失败会诱导用户再点一次，而每次点击都是新的真实提交。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');
const { WRITE_OUTCOME, toViewState } = require('../../utils/failure');
const { BIZ_CODE, PROFILE_LIMITS } = require('../../config/contracts');
const { QUERY_OUTCOME } = require('../../services/submission');
const feedback = require('../../services/feedback');
const formSubmit = require('../../behaviors/form-submit');
const location = require('../../utils/location');

Page({
  behaviors: [formSubmit],

  data: {
    viewState: createViewState(VIEW_STATE.LOADING),
    showContent: false,
    observation: null,
    typeOptions: [],
    selectedType: '',
    description: '',
    descriptionMax: PROFILE_LIMITS.FEEDBACK_DESCRIPTION_MAX,
    unknownVisible: false,
    // 已提交过 / 窗口已关闭：再点也不会成立，停用提交但不丢弃已填文字
    cannotSubmit: false,
    submitting: false,
    locationFailed: false,
  },

  async onLoad(query) {
    this._observationId = String((query && query.observationId) || '').trim();
    this._claimToken = String((query && query.claimToken) || '').trim();
    if (!this._observationId) {
      this.setData({ viewState: createViewState(VIEW_STATE.TERMINAL_ERROR, {
        description: '缺少反馈对象，请重新从摊主详情进入',
      }) });
      return;
    }
    await this.prepare();
  },

  /** 绑定匿名观察 → 在候选里定位该观察 → 读出窗口、版本与可选类型。 */
  async prepare() {
    try {
      const prepared = await feedback.prepareSubmission({
        observationId: this._observationId,
        claimToken: this._claimToken,
      });
      this._claimToken = ''; // 令牌一次性，无论成败都不再持有
      const candidate = (prepared && prepared.candidate) || null;
      if (!candidate || !candidate.eligible) {
        this.setData({ showContent: false, viewState: this.windowClosedState(candidate && candidate.windowText) });
        return;
      }
      this._observationVersion = candidate.observationVersion;
      this.setData({
        showContent: true,
        observation: {
          vendorName: candidate.vendorName,
          eventText: candidate.eventText,
          windowText: candidate.windowText,
          submittedTypes: candidate.submittedTypes,
        },
        typeOptions: prepared.typeOptions,
        viewState: createViewState(VIEW_STATE.CONTENT),
      });
    } catch (error) {
      this.setData({ showContent: false, viewState: toViewState(error) });
    }
  },

  windowClosedState(extra) {
    return createViewState(VIEW_STATE.TERMINAL_ERROR, {
      title: '本次反馈已无法提交',
      // extra 为候选窗口文案：有值=本轮已过期，无值=反馈对象已不在候选里；只上屏短状态句
      description: extra ? '本轮已结束' : '反馈对象不可用',
    });
  },

  onTypeChange(event) {
    const option = this.data.typeOptions.find((item) => item.value === event.detail.value);
    if (!option || option.disabled) return;
    this.setData({ selectedType: option.value });
  },

  onDescriptionInput(event) { this.setData({ description: event.detail.value }); },

  /** 只重新取位置，成功即复位定位失败态；不进入 submitFeedback 提交链。 */
  async onRelocate() {
    try {
      await location.getCurrentLocation();
      this.setData({ locationFailed: false });
    } catch (error) {
      // 仍不可用时保留失败态，仅给轻量提示
      void error;
      wx.showToast({ title: '仍无法获取位置', icon: 'none' });
    }
  },

  onBack() { wx.navigateBack(); },

  async onSubmit() {
    if (!this.data.selectedType) {
      wx.showToast({ title: '请先选择现场情况', icon: 'none' });
      return;
    }
    if (this.isSubmitting()) return;
    this._locationFailed = false;
    this.setData({ submitting: true, unknownVisible: false, cannotSubmit: false });
    try {
      const result = await this.runFormSubmit({
        submitter: async () => {
          try {
            return await feedback.submitFeedback({
              observationId: this._observationId,
              observationVersion: this._observationVersion,
              type: this.data.selectedType,
              description: this.data.description,
            });
          } catch (error) {
            // 定位失败以 ApiError.data.locationFailure 明确透出；只记录标识，错误原样抛回 form-submit
            this._locationFailed = Boolean(error && error.data && error.data.locationFailure);
            throw error;
          }
        },
        onSuccess: (data) => this.finish(data),
        onUnknown: () => this.setData({ unknownVisible: true }),
      });
      this.applySubmitResult(result);
    } finally {
      this.setData({
        submitting: false,
        locationFailed: Boolean(this._locationFailed),
      });
    }
  },

  /** 两类"再点也不会成立"的结局换专门文案并停用提交；已填文字保留。 */
  applySubmitResult(result) {
    if (!result) return;
    if (result.outcome === WRITE_OUTCOME.CONFLICT && result.bizCode === BIZ_CODE.ALREADY_PROCESSED) {
      this.setData({
        cannotSubmit: true,
        submitMessage: '可在反馈记录里查看进度',
      });
      return;
    }
    if (result.terminal) this.setData({ cannotSubmit: true });
  },

  /** 结果未知时唯一的出口：按原操作键查，成立就进结果页，不重新提交。 */
  async onQueryOutcome() {
    const result = await feedback.querySubmitOutcome();
    if (result.outcome === QUERY_OUTCOME.SUCCEEDED) { this.finish(result.data); return; }
    if (result.outcome === QUERY_OUTCOME.FAILED) {
      this.setData({ unknownVisible: false });
      this.resetSubmitState();
      wx.showToast({ title: '上次提交未成立，可以重新提交', icon: 'none' });
      return;
    }
    wx.showToast({ title: '仍在处理中，请稍后再查', icon: 'none' });
  },

  /** 合并提示只在展示层：同一次观察补充另一类问题时并入同一待处理事项。 */
  finish(data) {
    const payload = data || {};
    const previousTypes = (this.data.observation && this.data.observation.submittedTypes) || [];
    const merged = previousTypes.length > 0
      && previousTypes.indexOf(this.data.selectedType) < 0;
    const query = `feedbackId=${payload.feedbackFactId || ''}&status=${payload.status || 'PENDING'}`
      + `&submittedAtMs=${payload.acceptedAtMs || Date.now()}&merged=${merged ? 1 : 0}`;
    wx.redirectTo({ url: `/pages/feedback-result/index?${query}` });
  },

  onOpenRecords() { wx.navigateTo({ url: '/pages/feedback-candidates/index' }); },

  onStateAction() { if (this._observationId) this.prepare(); },
});

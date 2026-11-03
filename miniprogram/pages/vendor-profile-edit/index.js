/**
 * P08 申请或修改资料。
 *
 * 五项文字：名称、品类、常卖内容、价格说明、公告。全部必填（后端 G-01 已确认）。
 * 不接收固定地址、图片、日历、福利 —— 那些属于后续阶段。
 *
 * 提交状态机走 behaviors/form-submit：超时是「结果未知」，
 * 显示成失败会诱导用户再点一次，而每次点击都是一次新的真实申请。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');
const { WRITE_OUTCOME, toViewState } = require('../../utils/failure');
const { QUERY_OUTCOME } = require('../../services/submission');
const { PROFILE_LIMITS } = require('../../config/contracts');
const profile = require('../../services/profile');
const formSubmit = require('../../behaviors/form-submit');

const EMPTY_FORM = {
  vendorName: '',
  categoryCode: '',
  regularItemsText: '',
  priceDescription: '',
  announcement: '',
};

Page({
  behaviors: [formSubmit],

  data: {
    viewState: createViewState(VIEW_STATE.LOADING),
    showContent: false,
    form: { ...EMPTY_FORM },
    categoryOptions: [],
    categoryIndex: 0,
    categoryText: '请选择品类',
    fieldErrors: {},
    limits: {
      vendorName: PROFILE_LIMITS.VENDOR_NAME_MAX,
      regularItemsText: PROFILE_LIMITS.REGULAR_ITEMS_MAX,
      priceDescription: PROFILE_LIMITS.PRICE_DESCRIPTION_MAX,
      announcement: PROFILE_LIMITS.ANNOUNCEMENT_MAX,
    },
    unknownVisible: false,
    submitting: false,
  },

  async onLoad() {
    this.setData({ categoryOptions: profile.listCategoryOptions() });
    await this.loadProfile();
  },

  /** 读本人资料：既拿到预填内容，也拿到提交要用的版本基准。 */
  async loadProfile({ keepForm = false } = {}) {
    try {
      const model = await profile.loadProfile();
      this._expectedVendorVersion = model.expectedVendorVersion;
      const seed = profile.toFormSeed(model);
      const options = this.data.categoryOptions;
      const index = options.findIndex((item) => item.code === seed.categoryCode);
      // keepForm 用于版本冲突后只刷新版本基准：用户已填的内容不能被读模型覆盖
      this.setData({
        showContent: true,
        form: keepForm ? this.data.form : { ...EMPTY_FORM, ...seed },
        categoryIndex: keepForm ? this.data.categoryIndex : (index >= 0 ? index : 0),
        categoryText: keepForm ? this.data.categoryText : (index >= 0 ? options[index].pickerText : '请选择品类'),
        viewState: createViewState(VIEW_STATE.CONTENT),
      });
    } catch (error) {
      this.setData({ showContent: false, viewState: toViewState(error) });
    }
  },

  onStateAction() { this.loadProfile(); },

  onCategoryChange(event) {
    const index = Number(event.detail.value);
    const option = this.data.categoryOptions[index];
    if (!option) return;
    this.setData({
      categoryIndex: index,
      categoryText: option.pickerText,
      'form.categoryCode': option.code,
      'fieldErrors.categoryCode': '',
    });
    this.syncLeaveGuard();
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: event.detail.value, [`fieldErrors.${field}`]: '' });
    this.syncLeaveGuard();
  },

  /** 有未提交内容时给返回键加确认提示，避免用户误退丢失已填文字。 */
  syncLeaveGuard() {
    this.applyLeaveGuard(this.data.form, '资料还没提交，离开会丢失已填写的内容');
  },

  async onSubmit() {
    if (this.isSubmitting()) return;
    this.setData({ submitting: true });
    try {
      const result = await this.runFormSubmit({
        submitter: () => profile.submitProfile(this.data.form, {
          expectedVendorVersion: this._expectedVendorVersion || 0,
        }),
        onSuccess: () => this.finish(),
        onUnknown: () => this.setData({ unknownVisible: true }),
      });
      this.applyResult(result);
    } finally {
      this.setData({ submitting: false });
    }
  },

  /** 字段错误回到原表单项；冲突时只刷新版本基准，保留已填内容。 */
  applyResult(result) {
    if (!result) return;
    if (result.outcome === WRITE_OUTCOME.INVALID) {
      this.setData({ fieldErrors: result.errors || {} });
      return;
    }
    if (result.outcome === WRITE_OUTCOME.CONFLICT) {
      this.setData({ fieldErrors: {} });
      this.loadProfile({ keepForm: true });
    }
  },

  /** 结果未知时唯一的出口：按原操作键查，成立就回资料页，不重新提交。 */
  async onQueryOutcome() {
    const result = await profile.querySubmitOutcome();
    if (result.outcome === QUERY_OUTCOME.SUCCEEDED) { this.finish(); return; }
    // NO_PENDING 表示没有待确认的键，上一次提交已落定，可以重新提交
    if (result.outcome === QUERY_OUTCOME.FAILED || result.outcome === QUERY_OUTCOME.NO_PENDING) {
      this.setData({ unknownVisible: false });
      this.resetSubmitState();
      wx.showToast({ title: '上次提交未成立，可以重新提交', icon: 'none' });
      return;
    }
    wx.showToast({ title: '仍在处理中，请稍后再查', icon: 'none' });
  },

  finish() {
    this.clearLeaveGuard();
    wx.navigateBack();
  },
});

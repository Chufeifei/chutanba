/**
 * 摊主资料读模型整形（P07 / P08 共用）。
 *
 * 后端 profile/mapper.js 的 toSelfProfile 已经做了服务端裁剪，这里只做展示层整形：
 * 补中文标签、补品类名、把「能不能提交」变成布尔量。
 * 页面据此渲染，不再自己判断 profileState。
 */
const { PROFILE_STATE, PROFILE_STATE_LABEL, PROFILE_REVIEW_STATUS } = require('../../config/contracts');
const { getCategoryName } = require('../../config/categories');
const { formatMoment } = require('../../utils/formatter');

// 各资料阶段的本人可见说明。与需求文档 §4 的措辞保持一致，不在页面里另写一套。
const STATE_HINT = Object.freeze({
  [PROFILE_STATE.NONE]: '提交资料并通过审核后即可开摊。',
  [PROFILE_STATE.FIRST_PENDING]: '资料审核中，审核通过后才能开摊。',
  [PROFILE_STATE.FIRST_REJECTED]: '本次申请未通过，可按原因修改后重新提交。',
  [PROFILE_STATE.INVALIDATED]: '资料已清除或失效，需要重新提交并通过审核。',
  [PROFILE_STATE.UPDATE_PENDING]: '修改审核中，原资料继续使用。',
  [PROFILE_STATE.UPDATE_REJECTED]: '本次修改未生效，原资料继续使用。',
  [PROFILE_STATE.ACTIVE]: '当前资料已生效。',
});

// 处于这五种状态时页面可以进入 P08 提交；两种待审状态由服务端拒绝重复提交。
const SUBMITTABLE_STATES = [
  PROFILE_STATE.NONE,
  PROFILE_STATE.FIRST_REJECTED,
  PROFILE_STATE.UPDATE_REJECTED,
  PROFILE_STATE.INVALIDATED,
  PROFILE_STATE.ACTIVE,
];

// 提交入口的按钮文案。wxml 不做业务状态判断，文案统一在这里给。
const SUBMIT_ENTRY_TEXT = Object.freeze({
  [PROFILE_STATE.NONE]: '申请成为摊主',
  [PROFILE_STATE.FIRST_REJECTED]: '重新申请资料',
  [PROFILE_STATE.UPDATE_REJECTED]: '修改资料',
  [PROFILE_STATE.INVALIDATED]: '重新提交资料',
  [PROFILE_STATE.ACTIVE]: '修改资料',
});

const REVIEW_STATUS_LABEL = Object.freeze({
  [PROFILE_REVIEW_STATUS.PENDING]: '审核中',
  [PROFILE_REVIEW_STATUS.APPROVED]: '已通过',
  [PROFILE_REVIEW_STATUS.REJECTED]: '未通过',
  [PROFILE_REVIEW_STATUS.INVALIDATED]: '已失效',
});

function toProfileText(raw, nowMs) {
  return {
    vendorName: raw.vendorName || '',
    categoryCode: raw.categoryCode || '',
    categoryName: getCategoryName(raw.categoryCode),
    regularItemsText: raw.regularItemsText || '',
    priceDescription: raw.priceDescription || '',
    announcement: raw.announcement || '',
  };
}

/**
 * @param {object} raw GET /vendor/profile 的 data
 * @param {number} [nowMs]
 */
function toProfileModel(raw, nowMs = Date.now()) {
  const state = (raw && raw.profileState) || PROFILE_STATE.NONE;
  const active = (raw && raw.activeProfile) || null;
  const pending = (raw && raw.pendingSubmission) || null;
  const decision = (raw && raw.latestDecision) || null;

  // 没有摊主行时服务端不返回 stateVersion；此时首次申请的版本基准必须是 0。
  const stateVersion = raw && Number.isSafeInteger(Number(raw.stateVersion))
    ? Number(raw.stateVersion) : 0;
  const hasVendor = state !== PROFILE_STATE.NONE || Boolean(active) || Boolean(pending);

  return {
    profileState: state,
    profileStateLabel: PROFILE_STATE_LABEL[state] || PROFILE_STATE_LABEL[PROFILE_STATE.NONE],
    stateHint: STATE_HINT[state] || '',
    stateVersion,
    // 首次申请服务端尚无摊主行，版本基准是 0；已有摊主时必须带当前版本，否则被判冲突。
    expectedVendorVersion: hasVendor ? stateVersion : 0,
    canSubmit: SUBMITTABLE_STATES.indexOf(state) >= 0,
    submitEntryText: SUBMIT_ENTRY_TEXT[state] || '',
    hasActive: Boolean(active),
    hasPending: Boolean(pending),
    activeProfile: active ? {
      ...toProfileText(active, nowMs),
      versionNo: Number(active.versionNo) || 0,
      approvedText: formatMoment(active.approvedAtMs || active.decidedAtMs, nowMs),
    } : null,
    pendingSubmission: pending ? {
      ...toProfileText(pending, nowMs),
      submissionId: String(pending.submissionId),
      versionNo: Number(pending.versionNo) || 0,
      reviewStatus: pending.reviewStatus,
      reviewStatusLabel: REVIEW_STATUS_LABEL[pending.reviewStatus] || '审核中',
      submittedText: formatMoment(pending.submittedAtMs, nowMs),
    } : null,
    latestDecision: decision ? {
      submissionId: String(decision.submissionId),
      reviewStatus: decision.reviewStatus,
      reviewStatusLabel: REVIEW_STATUS_LABEL[decision.reviewStatus] || '',
      reason: decision.reason || '',
      decidedText: formatMoment(decision.decidedAtMs, nowMs),
    } : null,
  };
}

/**
 * P08 表单的初始值：已有生效资料时用生效内容打底，驳回后让用户在原内容上改。
 * 没有生效资料时留空，由本人重新填写。
 */
function toFormSeed(model) {
  const source = model && model.activeProfile ? model.activeProfile : {};
  return {
    vendorName: source.vendorName || '',
    categoryCode: source.categoryCode || '',
    regularItemsText: source.regularItemsText || '',
    priceDescription: source.priceDescription || '',
    announcement: source.announcement || '',
  };
}

module.exports = {
  STATE_HINT,
  toProfileModel,
  toFormSeed,
};

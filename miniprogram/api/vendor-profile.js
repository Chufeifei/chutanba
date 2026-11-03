/**
 * 摊主资料接口（契约 §5.2）。
 *
 * 一期资料只有五项文字：名称、品类、常卖内容、价格说明、公告。
 * 不接收固定地址、图片、日历、福利 —— 那些属于后续阶段，
 * 旧包装里的 calendar / media / benefit 字段不要在此复活。
 */
const { get } = require('../utils/request');
const { VENDOR } = require('../config/endpoints');
const { writePost } = require('./core-v2');

/** 本人视角：当前生效资料、待审修改、最近审核结果（含本人可见原因）。 */
function getVendorProfile() {
  return get(VENDOR.PROFILE);
}

/**
 * 提交首次资料或修改。
 * expectedVendorVersion 用于版本冲突保护：版本已变时服务端返回 STATE_CONFLICT，
 * 页面须先读取最新状态，不能覆盖别人的处理结果。
 */
function submitVendorProfile({
  vendorName,
  categoryCode,
  regularItemsText,
  priceDescription,
  announcement,
  expectedVendorVersion,
} = {}, options) {
  return writePost(VENDOR.PROFILE_SUBMISSIONS, {
    vendorName,
    categoryCode,
    regularItemsText,
    priceDescription,
    announcement,
    expectedVendorVersion,
  }, options);
}

/** 查询某次申请结果；驳回不改变原生效资料。 */
function getProfileSubmission(submissionId) {
  return get(VENDOR.PROFILE_SUBMISSION_DETAIL(submissionId));
}

module.exports = { getVendorProfile, submitVendorProfile, getProfileSubmission };

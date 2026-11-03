/**
 * 摊主资料域入口（P07 读 / P08 写）。
 *
 * 页面一律 require 本文件，不直接碰 mapper.js / validate.js ——
 * 子文件是实现细节，跨层引用会让同一份口径出现第二份副本。
 *
 * 写命令只走 services/submission.runWrite：一次用户意图一个幂等键，
 * 超时后按原键查询结果，不换键重发（否则会产生第二次申请）。
 */
const profileApi = require('../../api/vendor-profile');
const { runWrite, queryOutcome } = require('../submission');
const { WRITE_OUTCOME } = require('../../utils/failure');
const { CATEGORY_ITEMS } = require('../../config/categories');
const mapper = require('./mapper');
const { validateProfileForm, toFieldErrors, reasonTextOf } = require('./validate');

// 与后端 modules/profile/service/submit.js 的 operationType 一致
const SUBMIT_OPERATION = 'PROFILE_SUBMIT';

/**
 * 读本人资料。
 * @returns {Promise<object>} 资料读模型（见 mapper.toProfileModel）
 */
async function loadProfile() {
  const response = await profileApi.getVendorProfile();
  return mapper.toProfileModel(response && response.data);
}

/**
 * 提交首次资料或修改。
 *
 * @param {object} form 五项文字
 * @param {object} [options]
 * @param {number} [options.expectedVendorVersion] 版本基准。
 *   首次申请时服务端尚无摊主行，必须传 0；已有摊主时传读模型里的 stateVersion，
 *   否则服务端按版本冲突拒绝，不会覆盖别人的处理结果。
 * @returns {Promise<{outcome: string, data?: object, message?: string, fields?: Array}>}
 */
async function submitProfile(form, { expectedVendorVersion = 0 } = {}) {
  const { ok, errors, normalized } = validateProfileForm(form);
  if (!ok) {
    // 本地校验不过就不发请求：字段错误必须回到原表单项，且保留用户已输入内容
    return {
      outcome: WRITE_OUTCOME.INVALID,
      message: '填写内容需要修改',
      fields: toFieldErrors(errors),
      errors,
    };
  }
  return runWrite({
    operationType: SUBMIT_OPERATION,
    execute: ({ idempotencyKey }) => profileApi.submitVendorProfile({
      ...normalized,
      expectedVendorVersion,
    }, { idempotencyKey }),
  }).then((result) => {
    // 服务端的字段错误是代码，本地校验给的是中文；统一成「字段 → 中文原因」交给表单定位
    if (result && result.outcome === WRITE_OUTCOME.INVALID) {
      return { ...result, errors: toErrorMap(result.fields) };
    }
    return result;
  });
}

/** 把 fields 列表转成 { field: 中文原因 }，页面按字段渲染错误。 */
function toErrorMap(fields) {
  const map = {};
  (Array.isArray(fields) ? fields : []).forEach((item) => {
    if (item && item.field) map[item.field] = reasonTextOf(item.reason);
  });
  return map;
}

/** 提交结果未知时按原操作键查询：查到成立就不再提交。 */
async function querySubmitOutcome() {
  return queryOutcome({ operationType: SUBMIT_OPERATION });
}

/**
 * 品类下拉选项。只给叶子码 —— 后端白名单只认这 25 个码，分组码会被判未知品类。
 */
function listCategoryOptions() {
  return CATEGORY_ITEMS.map((item) => ({
    code: item.code,
    name: item.name,
    groupName: item.groupName,
    pickerText: `${item.groupName} · ${item.name}`,
  }));
}

module.exports = {
  SUBMIT_OPERATION,
  loadProfile,
  submitProfile,
  querySubmitOutcome,
  listCategoryOptions,
  reasonTextOf,
  toFormSeed: mapper.toFormSeed,
};

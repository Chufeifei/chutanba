/**
 * 摊主资料相关枚举与字段长度。
 *
 * 最容易混的是两个"状态"：
 * - PROFILE_REVIEW_STATUS：单次申请（一次提交）的审核结论；
 * - PROFILE_STATE：本人当前所处资料阶段的七值派生，/me 与 /vendor/profile 返回的是这一组。
 */

// 资料审核状态：单次申请的审核结论（P07 的待审分区用它区分待审／已通过／未通过／已失效）
const PROFILE_REVIEW_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  INVALIDATED: 'INVALIDATED',
});

// 资料状态：后端 profile/mapper.js 的 deriveProfileState 七值派生
const PROFILE_STATE = Object.freeze({
  NONE: 'NONE',
  FIRST_PENDING: 'FIRST_PENDING',
  FIRST_REJECTED: 'FIRST_REJECTED',
  INVALIDATED: 'INVALIDATED',
  UPDATE_PENDING: 'UPDATE_PENDING',
  UPDATE_REJECTED: 'UPDATE_REJECTED',
  ACTIVE: 'ACTIVE',
});

const PROFILE_STATE_LABEL = Object.freeze({
  [PROFILE_STATE.NONE]: '未申请',
  [PROFILE_STATE.FIRST_PENDING]: '审核中',
  [PROFILE_STATE.FIRST_REJECTED]: '未通过',
  [PROFILE_STATE.INVALIDATED]: '已失效',
  [PROFILE_STATE.UPDATE_PENDING]: '修改审核中',
  [PROFILE_STATE.UPDATE_REJECTED]: '修改未通过',
  [PROFILE_STATE.ACTIVE]: '已生效',
});

// 开摊资格原因：服务端 profileEligibility.reasons 逐条返回，多条同时成立时全部返回
const ELIGIBILITY_REASON = Object.freeze({
  PROFILE_REQUIRED: 'PROFILE_REQUIRED',
  SELF_STOPPED: 'SELF_STOPPED',
  GOVERNANCE_PAUSED: 'GOVERNANCE_PAUSED',
  SESSION_ACTIVE: 'SESSION_ACTIVE',
});

const ELIGIBILITY_REASON_LABEL = Object.freeze({
  [ELIGIBILITY_REASON.PROFILE_REQUIRED]: '缺少已生效的摊主资料',
  [ELIGIBILITY_REASON.SELF_STOPPED]: '你已停止公开',
  [ELIGIBILITY_REASON.GOVERNANCE_PAUSED]: '当前处于治理暂停',
  [ELIGIBILITY_REASON.SESSION_ACTIVE]: '当前正在营业',
});

// 一期资料字段长度（§3），前端校验与后端同口径；超限报字段错误并保留原输入
// 长度按 Unicode 码点计（Array.from），不是 UTF-16 长度
const PROFILE_LIMITS = Object.freeze({
  VENDOR_NAME_MAX: 40,
  REGULAR_ITEMS_MAX: 200,
  PRICE_DESCRIPTION_MAX: 120,
  ANNOUNCEMENT_MAX: 300,
  FEEDBACK_DESCRIPTION_MAX: 300,
  LOCATION_NAME_MAX: 80,
});

module.exports = {
  PROFILE_REVIEW_STATUS,
  PROFILE_STATE,
  PROFILE_STATE_LABEL,
  ELIGIBILITY_REASON,
  ELIGIBILITY_REASON_LABEL,
  PROFILE_LIMITS,
};

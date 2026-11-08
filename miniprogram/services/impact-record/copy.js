/**
 * P13 文案。
 *
 * 三条纪律：
 * 1. 提出复核不解除任何限制，文案不得暗示"复核中已暂停执行"；
 * 2. 不展示反馈人身份、顾客坐标或内部证据；
 * 3. 三种拒绝原因必须分开说，不能统一成"操作失败"。
 */
const { BIZ_CODE } = require('../../config/contracts');

const TIP = Object.freeze({
  EMPTY: '暂时没有影响你的处理记录',
  REASON_REQUIRED: '请填写复核说明',
  REASON_TOO_LONG: '复核说明超出长度上限',
  SUBMITTED: '复核申请已提交',
  NOTICE: '复核不解除限制',
});

const SUBMIT_FAILURE_TEXT = Object.freeze({
  [BIZ_CODE.STATE_CONFLICT]: '该影响已有待人工复核的申请，或记录已更新，请刷新后查看',
  [BIZ_CODE.ALREADY_PROCESSED]: '该影响已有复核结论，不能重复申请',
  [BIZ_CODE.WINDOW_CLOSED]: '已超过可申请复核的期限',
  [BIZ_CODE.RESOURCE_NOT_FOUND]: '该处理记录不存在或不属于本人',
});

function submitFailureText(bizCode) {
  return SUBMIT_FAILURE_TEXT[bizCode] || '';
}

module.exports = { TIP, submitFailureText };

/**
 * 现场反馈相关枚举（顾客侧 P04～P06）。
 */

// 现场反馈问题类型：一期只这三类，无照片、无一般举报
const FEEDBACK_TYPE = Object.freeze({
  OWNER_ABSENT: 'OWNER_ABSENT',
  LOCATION_MISMATCH: 'LOCATION_MISMATCH',
  ALREADY_LEFT: 'ALREADY_LEFT',
});

const FEEDBACK_TYPE_LABEL = Object.freeze({
  OWNER_ABSENT: '老板不在',
  LOCATION_MISMATCH: '地点不符',
  ALREADY_LEFT: '已经离开',
});

// 反馈事项状态：本人可见三态，不展示内部证据
const FEEDBACK_CASE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  NOT_CONFIRMED: 'NOT_CONFIRMED',
});

const FEEDBACK_CASE_STATUS_LABEL = Object.freeze({
  PENDING: '待处理',
  CONFIRMED: '已核实',
  NOT_CONFIRMED: '未核实',
});

// 未核实的原因码：必须区分"证据不足"与"已证明不存在异常"（需求 C-03.6）
const FEEDBACK_REASON = Object.freeze({
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  DISPROVED: 'DISPROVED',
  MIXED: 'MIXED',
});

module.exports = {
  FEEDBACK_TYPE,
  FEEDBACK_TYPE_LABEL,
  FEEDBACK_CASE_STATUS,
  FEEDBACK_CASE_STATUS_LABEL,
  FEEDBACK_REASON,
};

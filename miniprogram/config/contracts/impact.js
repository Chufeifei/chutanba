/**
 * 影响记录与人工复核相关枚举（P13）。
 *
 * 复核结论语义（后端 decision.js）：
 * - UPHELD：维持原处理（本人复核未被支持）；
 * - REVOKED：撤销原处理（本人复核被支持）。
 * 提出复核本身不解除任何限制，文案不得暗示"复核中已暂停执行"。
 */

// 影响记录状态：只有 ACTIVE 才可申请复核
const IMPACT_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  REVOKED: 'REVOKED',
});

const IMPACT_STATUS_LABEL = Object.freeze({
  [IMPACT_STATUS.ACTIVE]: '生效中',
  [IMPACT_STATUS.REVOKED]: '已撤销',
});

// 影响来源：服务端也下发 sourceLabel，这里只作兜底
const IMPACT_SOURCE_LABEL = Object.freeze({
  FEEDBACK_CASE: '现场反馈核实成立',
  MANAGEMENT_ACTION: '管理处理措施',
});

// 人工复核状态：0014 迁移 CHECK 约束的三个值
const IMPACT_REVIEW_STATUS = Object.freeze({
  PENDING: 'PENDING',
  UPHELD: 'UPHELD',
  REVOKED: 'REVOKED',
});

const IMPACT_REVIEW_STATUS_LABEL = Object.freeze({
  [IMPACT_REVIEW_STATUS.PENDING]: '待人工复核',
  [IMPACT_REVIEW_STATUS.UPHELD]: '维持原处理',
  [IMPACT_REVIEW_STATUS.REVOKED]: '已撤销原处理',
});

// 复核说明长度上限：后端 schema.STATEMENT_MAX，按 Unicode 码点计
const IMPACT_REVIEW_STATEMENT_MAX = 1000;

module.exports = {
  IMPACT_STATUS,
  IMPACT_STATUS_LABEL,
  IMPACT_SOURCE_LABEL,
  IMPACT_REVIEW_STATUS,
  IMPACT_REVIEW_STATUS_LABEL,
  IMPACT_REVIEW_STATEMENT_MAX,
};

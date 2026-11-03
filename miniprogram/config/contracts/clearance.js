/**
 * 本人资料清除相关枚举（P12）。
 *
 * 三组概念不要混：
 * - CLEAR_SCOPE：本人请求的范围；
 * - CLEAR_REQUEST_STATUS：请求的处理进度；
 * - hiddenKinds / processedKinds：已隐藏 与 已清除 —— 隐藏不等于删除，文案必须分开。
 */

// 清除范围：ACCOUNT_DATA 若会留下无主摊主，预览须提示改选 ALL
const CLEAR_SCOPE = Object.freeze({
  ACCOUNT_DATA: 'ACCOUNT_DATA',
  VENDOR_DATA: 'VENDOR_DATA',
  ALL: 'ALL',
});

// 清除范围文案（契约 §5.3）
const CLEAR_SCOPE_LABEL = Object.freeze({
  [CLEAR_SCOPE.ACCOUNT_DATA]: '仅本人账号资料',
  [CLEAR_SCOPE.VENDOR_DATA]: '仅摊主公开资料与营业位置',
  [CLEAR_SCOPE.ALL]: '账号资料与摊主资料全部',
});

// 清除请求状态：0014 迁移 CHECK 约束的四个值
const CLEAR_REQUEST_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  PARTIAL_FAILED: 'PARTIAL_FAILED',
});

const CLEAR_REQUEST_STATUS_LABEL = Object.freeze({
  [CLEAR_REQUEST_STATUS.QUEUED]: '清除处理中',
  [CLEAR_REQUEST_STATUS.IN_PROGRESS]: '清除处理中',
  [CLEAR_REQUEST_STATUS.COMPLETED]: '可清除资料已清除',
  [CLEAR_REQUEST_STATUS.PARTIAL_FAILED]: '部分必要受限保留',
});

// 清除受影响的资料类别（预览 affectedKinds 与结果 processedKinds / hiddenKinds 共用）
const CLEAR_KIND_LABEL = Object.freeze({
  ACCOUNT_PROFILE: '账号资料',
  VENDOR_PROFILE: '摊主公开资料',
  SESSION_LOCATIONS: '营业位置记录',
});

// 必要保留类别：预览与结果摘要共用同一组 kind
const RETENTION_KIND_LABEL = Object.freeze({
  OPEN_FEEDBACK_EVIDENCE: '未结现场反馈证据',
  FEEDBACK_EVIDENCE: '已结案反馈证据',
  HELD_LOCATION: '关联未结事项的位置记录',
  EXTENDED_LOCATION: '事项结束后的延期位置记录',
  MANAGEMENT_AUDIT: '管理与治理审计记录',
  IMPACT_RECORD: '已成立影响与复核处理历史',
});

module.exports = {
  CLEAR_SCOPE,
  CLEAR_SCOPE_LABEL,
  CLEAR_REQUEST_STATUS,
  CLEAR_REQUEST_STATUS_LABEL,
  CLEAR_KIND_LABEL,
  RETENTION_KIND_LABEL,
};

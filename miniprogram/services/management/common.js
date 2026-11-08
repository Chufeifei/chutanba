/**
 * 管理分包编排层公共约定（一期）。
 *
 * 页面只依赖本层导出的函数，不直接读取接口层。
 * 这里统一三件事：写操作类型、服务端语义码到极短提示的换算、写结果解读。
 * 错误码与规则说明一律不进入页面文案。
 */
const { BIZ_CODE } = require('../../config/contracts');
const { WRITE_OUTCOME } = require('../../utils/failure');
const { QUERY_OUTCOME } = require('../submission');

// 与后端 modules/profile/service/decide.js 的 operationType 一致。
// 提交与结果查询必须共用同一个类型，否则按原键查不到上一次意图。
const DECISION_OPERATION = 'PROFILE_REVIEW_DECISION';

// 内部标记：服务端返回 202 且仍在途时使用，仅用于分支判断，不上屏。
const PROCESSING_MARK = 'MANAGEMENT_DECISION_PROCESSING';

// 只允许极短提示上屏；其余情形统一给一个不含错误码的短句。
const SHORT_TIP = Object.freeze({
  [BIZ_CODE.PERMISSION_DENIED]: '当前无权处理',
  [BIZ_CODE.RESOURCE_NOT_FOUND]: '任务不存在',
});

const DEFAULT_TIP = '暂时未能完成';

/** 读失败或写失败都按语义码给出极短提示，不暴露规则说明。 */
function tipOf(target) {
  const code = target && target.bizCode;
  return SHORT_TIP[code] || DEFAULT_TIP;
}

/** 写结果 → 页面分支（processing / succeeded / failed）。 */
function toDecisionView(result) {
  if (result && (result.bizCode === PROCESSING_MARK || result.outcome === WRITE_OUTCOME.UNKNOWN)) {
    return { kind: 'processing', message: '正在处理，请稍候' };
  }
  if (result && result.outcome === WRITE_OUTCOME.SUCCEEDED) {
    return { kind: 'succeeded', message: '已提交' };
  }
  if (result && (result.bizCode === BIZ_CODE.PERMISSION_DENIED
      || result.bizCode === BIZ_CODE.RESOURCE_NOT_FOUND)) {
    return { kind: 'failed', message: tipOf(result), terminal: true };
  }
  if (result && result.outcome === WRITE_OUTCOME.CONFLICT) {
    return { kind: 'failed', message: '状态已变化，请返回查看', reload: true };
  }
  return { kind: 'failed', message: DEFAULT_TIP };
}

/** 按原键查询后的分支，页面据此继续等待或收尾。 */
function toQueryView(result) {
  if (result && result.outcome === QUERY_OUTCOME.SUCCEEDED) {
    return { kind: 'succeeded', message: '已提交' };
  }
  if (result && (result.outcome === QUERY_OUTCOME.FAILED
      || result.outcome === QUERY_OUTCOME.NO_PENDING)) {
    return { kind: 'failed', message: '处理未成功，请返回重试' };
  }
  return { kind: 'processing', message: '正在处理，请稍候' };
}

module.exports = {
  DECISION_OPERATION,
  PROCESSING_MARK,
  tipOf,
  toDecisionView,
  toQueryView,
};

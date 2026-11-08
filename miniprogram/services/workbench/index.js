/**
 * 摊主工作台域入口（P09）。
 *
 * 页面一律 require 本文件，不直接碰 mapper.js / candidates.js / operate.js / copy.js。
 *
 * 读接口的两个特殊点：
 * 1. 尚未申请摊主资料时 GET /vendor/workbench 返回 RESOURCE_NOT_FOUND，
 *    这不是系统错误，而是「还没申请资料」的空态，页面要引导去 P07。
 * 2. 截止时间候选以**服务端时刻**为基准生成。客户端时钟不可信，
 *    用本机时间造候选会被服务端按时间无效拒绝。
 */
const sessionApi = require('../../api/vendor-session');
const { BIZ_CODE } = require('../../config/contracts');
const { WRITE_OUTCOME } = require('../../utils/failure');
const { QUERY_OUTCOME } = require('../submission');
const mapper = require('./mapper');
const candidates = require('./candidates');
const copy = require('./copy');
const operate = require('./operate');
const view = require('./view');

const ACTION = copy.ACTION;

const NO_VENDOR_COPY = Object.freeze({
  title: '还不是摊主',
  description: '请先提交摊主资料',
  actionText: '去申请资料',
});

/**
 * 读工作台快照。
 * @param {object} [options]
 * @param {number} [options.keepAtMs] 摊主已经选定的截止时间，轮询时保留这个选择
 */
async function loadWorkbench({ keepAtMs } = {}) {
  let response;
  try {
    response = await sessionApi.getWorkbench();
  } catch (error) {
    if (error && error.bizCode === BIZ_CODE.RESOURCE_NOT_FOUND) {
      return {
        noVendor: true,
        emptyCopy: { ...NO_VENDOR_COPY },
        model: null,
        cutoffOptions: [],
        cutoffIndex: 0,
        cutoffText: '',
        stateVersion: 0,
      };
    }
    throw error;
  }

  const data = (response && response.data) || {};
  // 以服务端时刻为基准：候选时段、阶段判定、截止文案都按同一个"现在"
  const baseMs = Number(data.serverNowMs) || Date.now();
  const cutoffOptions = candidates.buildCutoffOptions({
    candidates: data.openTimeCandidates,
    nowMs: baseMs,
  });
  const cutoffIndex = candidates.resolveIndex(cutoffOptions, keepAtMs);

  return {
    noVendor: false,
    model: mapper.toWorkbenchModel(data, baseMs),
    cutoffOptions,
    cutoffIndex,
    cutoffText: cutoffOptions[cutoffIndex] ? cutoffOptions[cutoffIndex].pickerText : '',
    stateVersion: Number(data.stateVersion) || 0,
    serverNowMs: baseMs,
  };
}

/** 三个写动作的统一入口：页面只给动作与参数，编排细节留在这里。 */
function runAction(action, params = {}) {
  const model = params.model;
  const cutoff = params.cutoff;
  if (action === ACTION.OPEN) {
    return operate.openSession({
      plannedEndAtMs: cutoff ? cutoff.atMs : 0,
      expectedVendorVersion: params.stateVersion || 0,
      locationName: params.locationName,
    });
  }
  if (action === ACTION.REFRESH) {
    return operate.refreshLocation({
      sessionId: model && model.sessionId,
      expectedSessionVersion: model && model.sessionVersion,
      locationName: params.locationName,
    });
  }
  if (action === ACTION.CLOSE) {
    return operate.closeSession({
      sessionId: model && model.sessionId,
      expectedSessionVersion: model && model.sessionVersion,
    });
  }
  return Promise.resolve({ outcome: WRITE_OUTCOME.FAILED, message: '未知的操作类型' });
}

/**
 * 结果未知时按原键查结果。返回归一后的结果类型，页面不必认 QUERY_OUTCOME。
 * NO_PENDING 表示没有待确认的键 —— 上一次操作已经落定，可以安全地重新发起。
 */
async function queryAction(action) {
  const operationType = operationTypeOf(action);
  if (!operationType) return { kind: 'failed' };
  const result = await operate.queryOutcomeOf(operationType);
  if (result.outcome === QUERY_OUTCOME.SUCCEEDED) return { kind: 'succeeded' };
  if (result.outcome === QUERY_OUTCOME.FAILED || result.outcome === QUERY_OUTCOME.NO_PENDING) {
    return { kind: 'failed' };
  }
  return { kind: 'processing' };
}

function operationTypeOf(action) {
  if (action === ACTION.OPEN) return operate.OPERATION.OPEN;
  if (action === ACTION.REFRESH) return operate.OPERATION.REFRESH;
  if (action === ACTION.CLOSE) return operate.OPERATION.CLOSE;
  return '';
}

module.exports = {
  ACTION,
  OPERATION: operate.OPERATION,
  DEFAULT_LOCATION_NAME: copy.DEFAULT_LOCATION_NAME,
  loadWorkbench,
  runAction,
  queryAction,
  toViewPayload: view.toViewPayload,
  toFailurePayload: view.toFailurePayload,
  confirmCopy: copy.confirmCopy,
  successTip: copy.successTip,
};

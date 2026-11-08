/**
 * 管理分包治理处理编排（治理暂停 / 解除）。
 *
 * 两条链路，全部复用已有 management-governance 接口封装与 services/submission：
 *   1. 治理任务读取 —— 摊主列表与治理上下文详情；
 *   2. 治理决定提交 —— 经 runWrite 注入 Idempotency-Key。
 *
 * 契约：
 * - 决定所需的版本基准只取 GET 详情响应的 governanceVersion，不由页面推断或写死；
 * - 所有写命令统一经 runWrite，不绕过、不裸调传输层；
 * - 202 / PROCESSING 与结果未知都只按原操作键调用 queryOutcome 轮询，不重发写命令；
 * - 读、写两侧遇到 PERMISSION_DENIED / RESOURCE_NOT_FOUND 只回极短提示，
 *   错误码与规则说明一律不上屏；
 * - 不接线后端未挂载的审计列表与工厂路由，也不伪造任何数据。
 */
const governanceApi = require('../../api/management-governance');
const { runWrite, queryOutcome } = require('../submission');
const { ApiError, ERROR_CATEGORY } = require('../../utils/failure');
const {
  PROCESSING_MARK,
  tipOf,
  toDecisionView,
  toQueryView,
} = require('./common');

// 与后端 modules/management/service.js 的 OPERATION_TYPE 完全一致。
// 结果查询 GET /me/operations/{operationType}/{key} 按类型精确匹配，
// 写错就查不到上一次意图；暂停与解除各用各的键，互不复用。
const OPERATION = Object.freeze({
  PAUSE: 'GOVERNANCE_PAUSE',
  RESTORE: 'GOVERNANCE_RESTORE',
});

// 治理动作取自后端白名单（PAUSE / RESTORE），与操作类型一一对应。
const ACTION = Object.freeze({ PAUSE: 'PAUSE', RESTORE: 'RESTORE' });

// 页面可见文案统一在此收口，均为状态、字段、动作与极短提示。
const TIP = Object.freeze({
  LOADING: '正在加载',
  EMPTY: '暂无待处理对象',
  PROCESSING: '正在处理，请稍候',
  FAIL: '暂时未能完成',
});

function operationTypeOf(action) {
  if (action === ACTION.PAUSE) return OPERATION.PAUSE;
  if (action === ACTION.RESTORE) return OPERATION.RESTORE;
  return '';
}

/** 毫秒时间戳转短文本；无值给占位符，不推算。 */
function timeText(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const date = new Date(value);
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 列表摘要只留状态、字段与标识，全部来自 GET 响应。 */
function toVendorItem(row) {
  return {
    vendorId: String(row.vendorId || ''),
    vendorName: row.vendorName || row.vendorCode || '—',
    statusText: row.governancePaused ? '暂停中' : '正常',
    paused: Boolean(row.governancePaused),
  };
}

/**
 * 详情响应裁成页面字段。
 * 决定类版本字段（governanceVersion / currentSession.version）原样取自 GET 详情，
 * 不推断、不写死；处理人身份不在投影里，留占位符而不伪造。
 */
function toDetailModel(detail) {
  const controls = detail.controls || {};
  const paused = controls.governancePausedAtMs !== null && controls.governancePausedAtMs !== undefined;
  const actions = Array.isArray(detail.recentActions) ? detail.recentActions : [];
  const latest = actions.length ? actions[0] : null;
  const session = detail.currentSession || null;
  return {
    vendorId: String(detail.vendorId || ''),
    vendorName: detail.vendorName || detail.vendorCode || '—',
    statusText: paused ? '暂停中' : '正常',
    effectiveText: timeText(latest && latest.effectiveAtMs),
    actorText: '—',
    paused,
    governanceVersion: detail.governanceVersion,
    currentSessionVersion: session ? session.version : null,
  };
}

/** 链路一：治理摊主列表读取。失败只回极短提示，错误码与规则说明不上屏。 */
async function loadGovernanceVendors() {
  try {
    const response = await governanceApi.listGovernanceVendors();
    const rows = (response && response.data && response.data.rows) || [];
    return { ok: true, vendors: rows.map(toVendorItem) };
  } catch (error) {
    return { ok: false, tip: tipOf(error) };
  }
}

/** 链路一：治理任务详情读取，版本随模型回传，供决定按钮取用。 */
async function loadGovernanceDetail(vendorId) {
  const id = String(vendorId || '').trim();
  if (!id) return { ok: true, empty: true };
  try {
    const response = await governanceApi.getGovernanceContext(id);
    return { ok: true, model: toDetailModel((response && response.data) || {}) };
  } catch (error) {
    return { ok: false, tip: tipOf(error) };
  }
}

/**
 * 链路二：治理决定提交。
 * expectedGovernanceVersion 来自 loadGovernanceDetail 的 GET 详情，页面原样带回。
 * execute 内识别 202 PROCESSING：转成「结果未知」让 runWrite 保留原键，
 * 页面随后按原键反复调用 queryDecisionOutcome 轮询，绝不重发。
 */
function submitDecision({ vendorId, action, reason, expectedGovernanceVersion }) {
  const operationType = operationTypeOf(action);
  const version = Number(expectedGovernanceVersion);
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!operationType) return Promise.resolve({ kind: 'failed', message: TIP.FAIL });
  if (!Number.isSafeInteger(version) || version < 1) {
    return Promise.resolve({ kind: 'failed', message: '状态已变化，请重新进入' });
  }
  if (!text) return Promise.resolve({ kind: 'failed', message: '请填写处理原因' });
  return runWrite({
    operationType,
    execute: async ({ idempotencyKey }) => {
      const response = await governanceApi.decideGovernance(
        String(vendorId),
        { action, reason: text, expectedGovernanceVersion: version },
        { idempotencyKey },
      );
      const data = response && response.data;
      if (data && data.status === 'PROCESSING') {
        throw new ApiError({
          message: PROCESSING_MARK,
          category: ERROR_CATEGORY.RETRYABLE,
          maybeDelivered: true,
          bizCode: PROCESSING_MARK,
        });
      }
      return response;
    },
  }).then(toDecisionView);
}

/**
 * 按原键查询一次，供页面轮询或手动查看结果。
 * 202 / PROCESSING 时 queryOutcome 会保留原键，页面下一轮仍用同一把键查，
 * 全程不再发起写命令，避免换意图重发。
 */
function queryDecisionOutcome(action) {
  const operationType = operationTypeOf(action);
  if (!operationType) return Promise.resolve({ kind: 'failed', message: TIP.FAIL });
  return queryOutcome({ operationType }).then(toQueryView);
}

module.exports = {
  ACTION,
  OPERATION,
  TIP,
  loadGovernanceVendors,
  loadGovernanceDetail,
  submitDecision,
  queryDecisionOutcome,
};

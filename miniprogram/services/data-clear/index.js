/**
 * 资料清除域入口（P12）。
 *
 * 页面只 require 本文件。
 *
 * 流程硬约束：**先加载预览再允许提交**。预览会说明可清除范围、当前营业影响、
 * 待审与未结事项，以及按规则仍要保留的最小记录；跳过预览提交等于让本人盲签。
 *
 * 提交前必须刷新账号快照拿 accountVersion：账号版本在服务端锁内比对，
 * 用过期版本会稳定得到 STATE_CONFLICT，看起来像"总是失败"。
 */
const api = require('../../api/data-clear');
const account = require('../account');
const {
  CLEAR_SCOPE,
  CLEAR_SCOPE_LABEL,
  OPERATION_TYPE,
} = require('../../config/contracts');
const { WRITE_OUTCOME } = require('../../utils/failure');
const { runWrite, queryOutcome, QUERY_OUTCOME } = require('../submission');
const previewMapper = require('./preview');
const requestMapper = require('./request');
const copy = require('./copy');

// 默认范围取最窄的一项：默认替本人选更大范围等于替他做决定
const SCOPE_ORDER = [CLEAR_SCOPE.VENDOR_DATA, CLEAR_SCOPE.ACCOUNT_DATA, CLEAR_SCOPE.ALL];
const SCOPE_OPTIONS = SCOPE_ORDER.map((value) => ({ value, label: CLEAR_SCOPE_LABEL[value] }));

/** 预览没拿到、或被要求改选全部资料时都不允许提交。 */
function canSubmitOf(preview) {
  return Boolean(preview) && !preview.requiresExplicitAll;
}

async function loadPreview({ scope = CLEAR_SCOPE.VENDOR_DATA } = {}) {
  const response = await api.previewDataClear({ scope });
  const model = previewMapper.toPreviewModel((response && response.data) || {});
  return {
    model,
    canSubmit: canSubmitOf(model),
    blockedText: copy.previewHint(model),
  };
}

async function loadRequests({ cursor = '', previous = null } = {}) {
  const response = await api.listDataClearRequests({ cursor: cursor || undefined });
  const page = requestMapper.toRequestsModel((response && response.data) || {});
  return previous ? requestMapper.appendPage(previous, page) : page;
}

/** 取账号版本；失败时不发起请求，避免必然失败的写命令。 */
async function resolveAccountVersion() {
  try {
    const snapshot = await account.refreshIdentity();
    const version = snapshot ? Number(snapshot.accountVersion) : NaN;
    return Number.isFinite(version) && version > 0 ? version : null;
  } catch (error) {
    return null;
  }
}

async function submitClear({ scope }) {
  const expectedAccountVersion = await resolveAccountVersion();
  if (expectedAccountVersion === null) {
    return { outcome: WRITE_OUTCOME.FAILED, message: copy.TIP.ACCOUNT_VERSION_FAILED };
  }
  return runWrite({
    operationType: OPERATION_TYPE.DATA_CLEAR_REQUEST,
    execute: ({ idempotencyKey }) => api.createDataClearRequest(
      { scope, expectedAccountVersion },
      { idempotencyKey },
    ),
  });
}

/**
 * 范围需要升级时后端给的是 VALIDATION_FAILED + fields[scope]=SCOPE_UPGRADE_REQUIRED，
 * 只看 VALIDATION_FAILED 会把它当成普通输入错误，用户会反复重试同一个范围。
 */
function isScopeUpgradeRequired(result) {
  const fields = (result && result.fields) || [];
  return fields.some((item) => item && item.field === 'scope' && item.reason === 'SCOPE_UPGRADE_REQUIRED');
}

async function queryAction() {
  const result = await queryOutcome({ operationType: OPERATION_TYPE.DATA_CLEAR_REQUEST });
  if (result.outcome === QUERY_OUTCOME.SUCCEEDED) return { kind: 'succeeded', data: result.data };
  if (result.outcome === QUERY_OUTCOME.FAILED || result.outcome === QUERY_OUTCOME.NO_PENDING) {
    return { kind: 'failed', data: result.data };
  }
  return { kind: 'processing' };
}

/**
 * 写结果的统一解读：页面只渲染 message，按 reload / unknownVisible 决定后续动作。
 * 范围升级要单独一档 —— 它长得像输入错误，实际是"必须改选全部资料"。
 */
function toOutcomeView(result) {
  const outcome = result && result.outcome;
  if (outcome === WRITE_OUTCOME.SUCCEEDED) {
    return { kind: 'succeeded', message: copy.TIP.SUBMITTED, reload: true, unknownVisible: false };
  }
  if (outcome === WRITE_OUTCOME.UNKNOWN) {
    return {
      kind: 'unknown',
      message: '网络中断，尚不确定清除请求是否成立，请先查看最新结果。',
      reload: false,
      unknownVisible: true,
    };
  }
  if (isScopeUpgradeRequired(result)) {
    return {
      kind: 'scope-upgrade',
      message: copy.TIP.NEED_EXPLICIT_ALL,
      reload: true,
      unknownVisible: false,
    };
  }
  if (outcome === WRITE_OUTCOME.CONFLICT) {
    return {
      kind: 'conflict',
      message: (result && result.message) || '账号状态已变化，请查看最新结果后重试。',
      reload: true,
      unknownVisible: true,
    };
  }
  return {
    kind: 'failed',
    message: (result && result.message) || '提交未能完成',
    reload: false,
    unknownVisible: false,
  };
}

module.exports = {
  SCOPE_OPTIONS,
  TIP: copy.TIP,
  loadPreview,
  loadRequests,
  submitClear,
  isScopeUpgradeRequired,
  canSubmitOf,
  previewHint: copy.previewHint,
  confirmCopy: copy.confirmCopy,
  toOutcomeView,
  queryAction,
};

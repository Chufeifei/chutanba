/**
 * 清除请求进度读模型（P12 第二步）。
 *
 * 四种状态必须分别表述，且 hidden（已隐藏）与 cleared（已清除）分开列：
 * 用「已隐藏」代替「已删除」是本页最容易犯的错。
 */
const { formatMoment } = require('../../utils/formatter');
const {
  CLEAR_SCOPE_LABEL,
  CLEAR_REQUEST_STATUS,
  CLEAR_REQUEST_STATUS_LABEL,
} = require('../../config/contracts');
const { kindLabel, toRetentionList } = require('./preview');

function toFailureItem(item) {
  const source = item || {};
  return {
    kindLabel: kindLabel(source.kind),
    reason: source.reason ? String(source.reason) : '按规则未能处理',
  };
}

function toFailureList(list) {
  return (Array.isArray(list) ? list : []).map(toFailureItem);
}

function toLabelList(list) {
  return (Array.isArray(list) ? list : []).map(kindLabel);
}

function statusFlags(status) {
  return {
    isProcessing: status === CLEAR_REQUEST_STATUS.QUEUED || status === CLEAR_REQUEST_STATUS.IN_PROGRESS,
    isCompleted: status === CLEAR_REQUEST_STATUS.COMPLETED,
    isPartial: status === CLEAR_REQUEST_STATUS.PARTIAL_FAILED,
  };
}

/**
 * @param {object} row GET /me/data-clear-requests 的 rows[i]
 */
function toRequestItem(row) {
  const source = row || {};
  const status = source.status || CLEAR_REQUEST_STATUS.QUEUED;
  const hiddenTexts = toLabelList(source.hiddenKinds);
  const processedTexts = toLabelList(source.processedKinds);
  const retained = toRetentionList(source.retainedKinds);
  const failures = toFailureList(source.failures);
  const completedAtMs = source.completedAtMs === null || source.completedAtMs === undefined
    ? null : Number(source.completedAtMs);

  return {
    clearRequestId: source.clearRequestId ? String(source.clearRequestId) : '',
    scopeLabel: CLEAR_SCOPE_LABEL[source.scope] || String(source.scope || ''),
    statusLabel: CLEAR_REQUEST_STATUS_LABEL[status] || '清除处理中',
    ...statusFlags(status),
    requestedText: formatMoment(source.requestedAtMs),
    dueText: formatMoment(source.dueAtMs),
    completedText: completedAtMs ? formatMoment(completedAtMs) : '',
    hasCompleted: completedAtMs !== null,
    // 「成立即隐藏」与「已去标识化」分开，避免被读成同一件事
    hiddenTexts,
    hiddenLineText: hiddenTexts.join('、'),
    hasHidden: hiddenTexts.length > 0,
    processedTexts,
    processedLineText: processedTexts.join('、'),
    hasProcessed: processedTexts.length > 0,
    retained,
    hasRetained: retained.length > 0,
    failures,
    hasFailures: failures.length > 0,
    overdue: Boolean(source.overdue),
    overdueReason: source.overdueReason ? String(source.overdueReason) : '',
  };
}

function toRequestsModel(raw) {
  const source = raw || {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  return {
    requests: rows.map(toRequestItem),
    hasRequests: rows.length > 0,
    nextCursor: source.nextCursor ? String(source.nextCursor) : '',
  };
}

function appendPage(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  return {
    ...next,
    requests: previous.requests.concat(next.requests),
    hasRequests: previous.requests.length + next.requests.length > 0,
  };
}

module.exports = { toRequestItem, toRequestsModel, appendPage };

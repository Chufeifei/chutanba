/**
 * 清除域对外投影：预览、请求与结果摘要。
 * 逐字段正向赋值，不把数据库行直接返回。
 */

/** 墓碑值：保留行与痕迹，只把可清除的完整值换成不可还原的占位。 */
const TOMBSTONE = Object.freeze({
  vendorName: '已清除',
  categoryCode: 'CLEARED',
  locationName: '位置已清除',
});

/** 受影响类别：请求范围 → 会被处理的类别集合。 */
const SCOPE_KINDS = Object.freeze({
  ACCOUNT_DATA: Object.freeze(['ACCOUNT_PROFILE']),
  VENDOR_DATA: Object.freeze(['VENDOR_PROFILE', 'SESSION_LOCATIONS']),
  ALL: Object.freeze(['ACCOUNT_PROFILE', 'VENDOR_PROFILE', 'SESSION_LOCATIONS']),
});

function kindsOf(scope) {
  return [...(SCOPE_KINDS[scope] || [])];
}

function parseScopeJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    return null;
  }
}

/** 清除预览：范围、生效范围、受影响范围与保留说明一次给全。 */
function toPreview({
  scope, effectiveScope, requiresExplicitAll, affectedKinds, activeSessionImpact,
  pendingReviewImpact, retentionExceptions, estimatedCompletion,
}) {
  return {
    scope,
    effectiveScope,
    requiresExplicitAll,
    affectedKinds,
    activeSessionImpact,
    pendingReviewImpact,
    retentionExceptions,
    estimatedCompletion,
  };
}

/** 清除请求行：本人只看到自己的处理状态、已处理范围、保留依据与失败原因。 */
function toRequestItem(row, { nowMs }) {
  const scope = parseScopeJson(row.scope_json) || {};
  const summary = parseScopeJson(row.result_summary_json) || {};
  const dueAtMs = Number(row.due_at_ms);
  const completed = row.completed_at_ms !== null && row.completed_at_ms !== undefined;
  const overdue = !completed && Number.isInteger(nowMs) && nowMs > dueAtMs;
  const item = {
    clearRequestId: String(row.id),
    scope: scope.requestedScope || null,
    effectiveScope: scope.effectiveScope || null,
    status: row.status,
    requestedAtMs: Number(row.accepted_at_ms),
    dueAtMs,
    completedAtMs: completed ? Number(row.completed_at_ms) : null,
    affectedKinds: Array.isArray(scope.affectedKinds) ? scope.affectedKinds : [],
    processedKinds: Array.isArray(summary.cleared) ? summary.cleared.map((item2) => item2.kind) : [],
    retainedKinds: Array.isArray(summary.retained) ? summary.retained : [],
    failures: Array.isArray(summary.failures) ? summary.failures : [],
    hiddenKinds: Array.isArray(summary.hidden) ? summary.hidden : [],
  };
  if (overdue) {
    item.overdue = true;
    item.overdueReason = '处理已超过约定的 30 个自然日期限，可重试未完成的部分';
  }
  return item;
}

module.exports = { TOMBSTONE, SCOPE_KINDS, kindsOf, parseScopeJson, toPreview, toRequestItem };

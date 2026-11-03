/**
 * 清除预览读模型（P12 第一步）。
 *
 * 预览回答三件事：会清掉什么、当前营业会怎样、哪些记录按规则仍要保留。
 * 预览不是执行 —— 这里不写任何业务数据，也不缓存"已同意"。
 */
const { formatMoment } = require('../../utils/formatter');
const {
  CLEAR_SCOPE,
  CLEAR_SCOPE_LABEL,
  CLEAR_KIND_LABEL,
  RETENTION_KIND_LABEL,
} = require('../../config/contracts');

function kindLabel(code) {
  return CLEAR_KIND_LABEL[code] || String(code || '');
}

function retentionLabel(code) {
  return RETENTION_KIND_LABEL[code] || String(code || '');
}

/** 必要保留条目：依据 + 到期时刻（未定时写明"事项结束前不清理"）。 */
function toRetentionItem(item) {
  const source = item || {};
  const dueAtMs = source.dueAtMs === null || source.dueAtMs === undefined ? null : Number(source.dueAtMs);
  const count = Number(source.count);
  return {
    kindLabel: retentionLabel(source.kind),
    basis: source.basis ? String(source.basis) : '',
    countText: Number.isFinite(count) && count > 0 ? `${count} 项` : '',
    dueText: dueAtMs ? `保留至 ${formatMoment(dueAtMs)}` : '相关事项结束前不清理',
    hasDue: dueAtMs !== null,
  };
}

function toRetentionList(list) {
  return (Array.isArray(list) ? list : []).map(toRetentionItem);
}

function toActiveSessionSection(raw) {
  const source = raw || {};
  if (!source.hasActiveSession) {
    return { hasActiveSession: false, willEnd: false, text: '当前没有正在进行的营业轮次。' };
  }
  return {
    hasActiveSession: true,
    willEnd: Boolean(source.willEnd),
    text: `当前有一轮营业正在进行（${formatMoment(source.startedAtMs)} 开始），请求成立时会立即结束这一轮。`,
  };
}

/** 待审与未结事项：逐条给数量与后果，不合并成一句"有影响"。 */
function toPendingSection(raw) {
  const source = raw || {};
  const notes = [];
  const pendingVersions = Number(source.pendingProfileVersions);
  if (Number.isFinite(pendingVersions) && pendingVersions > 0) {
    notes.push(`待审资料 ${pendingVersions} 份会置为失效，之后需重新提交并通过审核`);
  }
  const openCases = Number(source.openFeedbackCases);
  if (Number.isFinite(openCases) && openCases > 0) {
    notes.push(`有 ${openCases} 个未结现场反馈事项，按规则继续保留`);
  }
  const openReviews = Number(source.openImpactReviews);
  if (Number.isFinite(openReviews) && openReviews > 0) {
    notes.push(`有 ${openReviews} 份未结人工复核，按规则继续保留`);
  }
  return { hasNotes: notes.length > 0, notes };
}

/**
 * @param {object} raw GET /me/data-clear-preview 的 data
 */
function toPreviewModel(raw) {
  const source = raw || {};
  const scope = source.scope || CLEAR_SCOPE.VENDOR_DATA;
  const effectiveScope = source.effectiveScope || scope;
  const kindTexts = (Array.isArray(source.affectedKinds) ? source.affectedKinds : []).map(kindLabel);
  const retention = toRetentionList(source.retentionExceptions);
  const estimated = source.estimatedCompletion || {};
  const dueAtMs = estimated.dueAtMs === null || estimated.dueAtMs === undefined
    ? null : Number(estimated.dueAtMs);
  const requiresExplicitAll = Boolean(source.requiresExplicitAll);

  return {
    scope,
    scopeLabel: CLEAR_SCOPE_LABEL[scope] || scope,
    effectiveScope,
    effectiveScopeLabel: CLEAR_SCOPE_LABEL[effectiveScope] || '',
    requiresExplicitAll,
    // 预览说的是"生效范围"，被要求改选时两者不同，页面必须同时显示
    scopeMismatchText: requiresExplicitAll
      ? `按当前选择实际会清除：${CLEAR_SCOPE_LABEL[effectiveScope] || effectiveScope}`
      : '',
    kindTexts,
    kindLineText: kindTexts.join('、'),
    hasKinds: kindTexts.length > 0,
    activeSession: toActiveSessionSection(source.activeSessionImpact),
    pending: toPendingSection(source.pendingReviewImpact),
    retention,
    hasRetention: retention.length > 0,
    dueAtMs,
    dueText: dueAtMs ? formatMoment(dueAtMs) : '',
    dueDays: Number(estimated.days) || 0,
  };
}

module.exports = { kindLabel, toRetentionList, toPreviewModel };

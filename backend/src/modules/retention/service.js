/**
 * 保留期域：期限算期、保留挂起与「取较晚」判定。
 *
 * 口径来自两处，代码是实现不是规则来源：
 * - doc/MVP/一期MVP需求文档.md R-07：位置版本自停止公开起 180 自然日；一般审核与反馈证据
 *   自事项终态起 180 自然日；管理与高风险治理审计自事件发生起 1095 自然日；
 *   关联反馈、申诉或安全事项未结束时保留至事项结束后 30 自然日，与基础期限取较晚者。
 * - R-08：「自某时刻起 N 个自然日」= [起始时刻, 第 N 日相同本地钟点)。
 *
 * 三档期限只在本文件登记一次，其他域一律引用这里的常量。
 */
const { addShanghaiDays } = require('../session');
const repository = require('./repository');
const mapper = require('./mapper');

const RETENTION_DAYS = Object.freeze({
  LOCATION_EVIDENCE: 180, // 精确位置版本：自其自身停止公开时刻起
  GENERAL_EVIDENCE: 180, // 一般资料审核与反馈证据：自事项终态起
  MANAGEMENT_AUDIT: 1095, // 受限管理审计：自事件发生起
  CASE_EXTENSION: 30, // 未结事项结束后的延期
  CLEAR_REQUEST: 30, // 本人清除请求的处理窗口
});

const TARGET_TYPE = Object.freeze({
  LOCATION_VERSION: 'LOCATION_VERSION',
  FEEDBACK_CASE: 'FEEDBACK_CASE',
});

const SOURCE_TYPE = Object.freeze({
  FEEDBACK_CASE: 'FEEDBACK_CASE',
  IMPACT_REVIEW: 'IMPACT_REVIEW',
});

/** 基础截止：自某时刻起 N 个上海自然日的截止时刻。 */
function computeDueAtMs({ baseAtMs, days }) {
  if (!Number.isInteger(baseAtMs) || baseAtMs < 0) throw new TypeError('起算时刻必须是毫秒安全整数');
  if (!Number.isInteger(days) || days <= 0) throw new TypeError('保留天数必须是正整数');
  return addShanghaiDays(baseAtMs, days);
}

const locationEvidenceDueAtMs = (stoppedAtMs) => computeDueAtMs({
  baseAtMs: stoppedAtMs, days: RETENTION_DAYS.LOCATION_EVIDENCE,
});
const generalEvidenceDueAtMs = (closedAtMs) => computeDueAtMs({
  baseAtMs: closedAtMs, days: RETENTION_DAYS.GENERAL_EVIDENCE,
});
const managementAuditDueAtMs = (occurredAtMs) => computeDueAtMs({
  baseAtMs: occurredAtMs, days: RETENTION_DAYS.MANAGEMENT_AUDIT,
});
const caseExtensionDueAtMs = (closedAtMs) => computeDueAtMs({
  baseAtMs: closedAtMs, days: RETENTION_DAYS.CASE_EXTENSION,
});
const clearRequestDueAtMs = (acceptedAtMs) => computeDueAtMs({
  baseAtMs: acceptedAtMs, days: RETENTION_DAYS.CLEAR_REQUEST,
});

/** 多个候选截止取较晚者；忽略空值，全部为空时返回 null。 */
function latestDueAtMs(...candidates) {
  const values = candidates.filter((value) => Number.isInteger(value));
  return values.length ? Math.max(...values) : null;
}

/**
 * 开保留挂起：未结事项阻止清理。
 * 唯一键 (target_type,target_id,source_type,source_id) 保证重复调用不会挂两次。
 */
async function openHoldInTransaction(connection, {
  targetType, targetId, sourceType, sourceId, basis, openedAtMs,
}) {
  const existing = await repository.findHold(connection, {
    targetType, targetId, sourceType, sourceId,
  });
  if (existing) return Number(existing.id);
  try {
    return await repository.insertHold(connection, {
      targetType, targetId, sourceType, sourceId, basis, openedAtMs,
    });
  } catch (error) {
    // 并发下同一对象同一来源只留一条挂起：撞唯一键时复用已存在记录。
    if (error && error.code === 'ER_DUP_ENTRY') {
      const again = await repository.findHold(connection, {
        targetType, targetId, sourceType, sourceId,
      });
      if (again) return Number(again.id);
    }
    throw error;
  }
}

/**
 * 关闭挂起并写延期截止：事项结束（或复核决定）后保留至「结束时刻 + 30 自然日」。
 * 只关闭同一来源的挂起，别人的挂起不受影响。
 */
async function closeHoldsInTransaction(connection, {
  sourceType, sourceId, closedAtMs,
}) {
  const extendedDueAtMs = caseExtensionDueAtMs(closedAtMs);
  return repository.closeHoldsBySource(connection, {
    sourceType, sourceId, closedAtMs, extendedDueAtMs,
  });
}

/**
 * 批量解析位置版本的保留结论：
 * 存在未关闭挂起则 held=true（不清理）；否则取「自身 180 日截止」与各挂起延期截止的较晚者。
 */
async function resolveLocationRetentionsInTransaction(connection, { locations }) {
  if (!Array.isArray(locations) || locations.length === 0) return [];
  const holds = await repository.listHoldsByTargets(connection, {
    targetType: TARGET_TYPE.LOCATION_VERSION,
    targetIds: locations.map((item) => Number(item.id)),
  });
  const byTarget = new Map();
  for (const hold of holds) {
    const key = Number(hold.target_id);
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(hold);
  }
  return locations.map((item) => {
    const id = Number(item.id);
    const own = locationEvidenceDueAtMs(Number(item.stoppedAtMs));
    const rows = byTarget.get(id) || [];
    const open = rows.filter((row) => row.closed_at_ms === null);
    const extensions = rows
      .filter((row) => row.closed_at_ms !== null)
      .map((row) => Number(row.extended_due_at_ms))
      .filter((value) => Number.isInteger(value));
    return {
      locationId: id,
      baseDueAtMs: own,
      // 延期截止只来自已关闭的挂起：未结事项结束后保留 30 个自然日。
      extensionDueAtMs: extensions.length ? Math.max(...extensions) : null,
      dueAtMs: latestDueAtMs(own, ...extensions),
      held: open.length > 0,
      holds: rows.map((row) => mapper.toHold(row)),
    };
  });
}

/** 本人清除预览要读的保留例外：未关闭挂起逐条列出依据与到期时间。 */
async function listOpenHoldsInTransaction(connection, { targetType, targetIds }) {
  const rows = await repository.listHoldsByTargets(connection, { targetType, targetIds });
  return rows.filter((row) => row.closed_at_ms === null).map((row) => mapper.toHold(row));
}

module.exports = {
  RETENTION_DAYS,
  TARGET_TYPE,
  SOURCE_TYPE,
  computeDueAtMs,
  locationEvidenceDueAtMs,
  generalEvidenceDueAtMs,
  managementAuditDueAtMs,
  caseExtensionDueAtMs,
  clearRequestDueAtMs,
  latestDueAtMs,
  openHoldInTransaction,
  closeHoldsInTransaction,
  resolveLocationRetentionsInTransaction,
  listOpenHoldsInTransaction,
};

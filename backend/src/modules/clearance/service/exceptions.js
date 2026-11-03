/**
 * 保留例外清单：清除后仍按规则保留的最小记录，逐类给出依据与到期时间。
 *
 * 预览与清理批次共用同一份口径：结果里写的保留依据必须与预览看到的一致。
 */
const feedback = require('../../feedback');
const impact = require('../../impact');
const management = require('../../management');
const retention = require('../../retention');
const session = require('../../session');

/** 已结案的一般证据：事项终态后 180 个自然日删除或去标识化。 */
function closedEvidenceException(cases) {
  const closed = cases.filter((row) => row.status !== 'PENDING' && row.closed_at_ms !== null);
  if (!closed.length) return null;
  const dueAtMs = Math.max(...closed.map((row) => retention.generalEvidenceDueAtMs(Number(row.closed_at_ms))));
  return {
    kind: 'FEEDBACK_EVIDENCE',
    count: closed.length,
    basis: '一般审核与反馈证据在事项终态后保留 180 个自然日',
    dueAtMs,
  };
}

/** 未结反馈事项：事项结束前不得清理，结束后再保留 30 个自然日。 */
function openEvidenceException(cases) {
  const open = cases.filter((row) => row.status === 'PENDING');
  if (!open.length) return null;
  return {
    kind: 'OPEN_FEEDBACK_EVIDENCE',
    count: open.length,
    basis: '未结现场反馈事项，结束后再保留 30 个自然日',
    dueAtMs: null,
  };
}

/** 位置版本：未结挂起不得清理；已关闭挂起的延期截止未到也不得清理。 */
function locationExceptions(retentions) {
  const held = retentions.filter((item) => item.held);
  const extended = retentions.filter((item) => !item.held && item.extensionDueAtMs !== null);
  const result = [];
  if (held.length) {
    result.push({
      kind: 'HELD_LOCATION',
      count: held.length,
      basis: '关联未结反馈事项或影响复核，结束后再保留 30 个自然日',
      dueAtMs: null,
    });
  }
  if (extended.length) {
    result.push({
      kind: 'EXTENDED_LOCATION',
      count: extended.length,
      basis: '事项结束后的 30 个自然日延期已生效',
      dueAtMs: Math.max(...extended.map((item) => item.extensionDueAtMs)),
    });
  }
  return result;
}

/**
 * 摊主的保留例外清单。
 * 无摊主时返回空数组：没有摊主身份就没有可保留的摊主记录。
 */
async function readRetentionExceptions(connection, { vendorId, now }) {
  if (vendorId === null) return [];
  const cases = await feedback.listCaseRetentionInTransaction(connection, { vendorId });
  const locations = await session.listVendorLocationsInTransaction(connection, { vendorId });
  const retentions = await retention.resolveLocationRetentionsInTransaction(connection, {
    locations: locations.map((row) => ({
      id: Number(row.id),
      // 未停止的位置在清除请求成立时会被结束，按当前时刻起算基础期限。
      stoppedAtMs: row.stopped_at_ms === null ? now : Number(row.stopped_at_ms),
    })),
  });
  const actions = await management.countActionsByVendorInTransaction(connection, { vendorId });
  const impactCount = await impact.countRecordsByVendorInTransaction(connection, { vendorId });

  const result = [];
  const openEvidence = openEvidenceException(cases);
  if (openEvidence) result.push(openEvidence);
  const closedEvidence = closedEvidenceException(cases);
  if (closedEvidence) result.push(closedEvidence);
  result.push(...locationExceptions(retentions));
  if (actions.count > 0) {
    result.push({
      kind: 'MANAGEMENT_AUDIT',
      count: actions.count,
      basis: '管理与高风险治理审计自事件发生后保留 1095 个自然日',
      dueAtMs: retention.managementAuditDueAtMs(actions.latestAtMs),
    });
  }
  if (impactCount > 0) {
    result.push({
      kind: 'IMPACT_RECORD',
      count: impactCount,
      basis: '已成立影响与复核处理历史是处理凭据，不随清除删除',
      dueAtMs: null,
    });
  }
  return result;
}

module.exports = { readRetentionExceptions };

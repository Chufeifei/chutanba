/**
 * W8 纯函数用例：自然日算期、三档保留期限、挂起与复核入参。
 * 不依赖数据库：这些口径一旦被改坏，集成用例的失败信息往往指向别处。
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');

const retention = require('../src/modules/retention');
const session = require('../src/modules/session');
const impactSchema = require('../src/modules/impact/schema');
const clearanceSchema = require('../src/modules/clearance/schema');
const clearanceMapper = require('../src/modules/clearance/mapper');

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** 上海当地的某个时刻：2026-01-01 08:30（UTC+8）= 2026-01-01T00:30:00Z。 */
const SHANGHAI_2026_01_01_08_30 = Date.UTC(2026, 0, 1, 0, 30, 0);

function bizCodeOf(fn) {
  try {
    fn();
  } catch (error) {
    return error.bizCode;
  }
  return null;
}

test('自然日算期：自某时刻起 N 日落在同一当地钟点', () => {
  const due = session.addShanghaiDays(SHANGHAI_2026_01_01_08_30, 180);
  // 2026-01-01 + 180 天 = 2026-06-30，仍是当地 08:30。
  assert.equal(session.shanghaiDateKey(due), '2026-06-30');
  assert.equal(due - SHANGHAI_2026_01_01_08_30, 180 * DAY);
});

test('自然日算期：跨月、跨年与闰年按当地日历推进', () => {
  const feb29 = Date.UTC(2027, 1, 28, 0, 0, 0); // 2027-02-29 08:00（UTC+8）
  const due = session.addShanghaiDays(feb29, 1);
  assert.equal(session.shanghaiDateKey(due), '2027-03-01');
  const newYear = Date.UTC(2025, 11, 31, 16, 0, 0); // 2026-01-01 00:00（UTC+8）
  assert.equal(session.shanghaiDateKey(session.addShanghaiDays(newYear, 30)), '2026-01-31');
});

test('自然日算期：截止不含该时刻，左闭右开', () => {
  const base = SHANGHAI_2026_01_01_08_30;
  const due = retention.locationEvidenceDueAtMs(base);
  assert.ok(due > base, '截止时刻必须晚于起算时刻');
  assert.equal(due - base, 180 * DAY);
});

test('保留期限三档：位置 180 日、一般证据 180 日、管理审计 1095 日', () => {
  assert.equal(retention.RETENTION_DAYS.LOCATION_EVIDENCE, 180);
  assert.equal(retention.RETENTION_DAYS.GENERAL_EVIDENCE, 180);
  assert.equal(retention.RETENTION_DAYS.MANAGEMENT_AUDIT, 1095);
  assert.equal(retention.RETENTION_DAYS.CASE_EXTENSION, 30);
  assert.equal(retention.RETENTION_DAYS.CLEAR_REQUEST, 30);
  const base = SHANGHAI_2026_01_01_08_30;
  assert.equal(
    retention.generalEvidenceDueAtMs(base) - base, 180 * DAY,
    '一般证据按事项终态起 180 日',
  );
  assert.equal(
    retention.managementAuditDueAtMs(base) - base, 1095 * DAY,
    '管理审计按事件发生后 1095 日',
  );
  assert.equal(
    retention.caseExtensionDueAtMs(base) - base, 30 * DAY,
    '未结事项结束后再保留 30 日',
  );
  assert.equal(
    retention.clearRequestDueAtMs(base) - base, 30 * DAY,
    '清除请求自成立起 30 日内处理完',
  );
});

test('期限取较晚：基础期限与延期截止同时存在时取较晚者', () => {
  const base = SHANGHAI_2026_01_01_08_30;
  const own = retention.locationEvidenceDueAtMs(base);
  // 事项在基础期限之后才结束：延期截止（结束 + 30 日）比基础期限更晚。
  const lateExtension = retention.caseExtensionDueAtMs(base + 200 * DAY);
  assert.equal(retention.latestDueAtMs(own, lateExtension), lateExtension);
  // 事项在基础期限之前结束：仍以基础期限为准，不因延期规则提前清理。
  const earlyExtension = retention.caseExtensionDueAtMs(base + 10 * DAY);
  assert.equal(retention.latestDueAtMs(own, earlyExtension), own);
  assert.equal(retention.latestDueAtMs(own, own), own);
  assert.equal(retention.latestDueAtMs(null, undefined), null);
});

test('保留挂起类型与来源只允许登记过的枚举', () => {
  assert.deepEqual(Object.keys(retention.TARGET_TYPE).sort(), ['FEEDBACK_CASE', 'LOCATION_VERSION']);
  assert.deepEqual(Object.keys(retention.SOURCE_TYPE).sort(), ['FEEDBACK_CASE', 'IMPACT_REVIEW']);
});

test('影响复核入参：白名单、结论枚举与版本下界', () => {
  const valid = impactSchema.parseSubmitInput({
    impactRecordId: '12', reason: '  现场与描述不符 ', expectedImpactVersion: 3,
  });
  assert.equal(valid.impactRecordId, 12);
  assert.equal(valid.reason, '现场与描述不符');
  assert.equal(valid.expectedImpactVersion, 3);

  assert.equal(bizCodeOf(() => impactSchema.parseSubmitInput({
    impactRecordId: '12', reason: 'x', expectedImpactVersion: 3, extra: 1,
  })), 'VALIDATION_FAILED', '未知字段必须拒绝');
  assert.equal(bizCodeOf(() => impactSchema.parseSubmitInput({
    impactRecordId: '12', reason: 'x', expectedImpactVersion: -1,
  })), 'VALIDATION_FAILED', '版本不得为负');
  assert.equal(bizCodeOf(() => impactSchema.parseSubmitInput({
    impactRecordId: '12', reason: '', expectedImpactVersion: 1,
  })), 'VALIDATION_FAILED', '理由不得为空');
});

test('管理复核决定：只允许 UPHELD／REVOKED，理由必填', () => {
  const valid = impactSchema.parseDecision({
    decision: 'REVOKED', reason: '核实后不成立', expectedTaskVersion: 1,
  });
  assert.equal(valid.decision, 'REVOKED');
  assert.equal(bizCodeOf(() => impactSchema.parseDecision({
    decision: 'DISMISS', reason: 'x', expectedTaskVersion: 1,
  })), 'VALIDATION_FAILED', '结论枚举外的取值必须拒绝');
  assert.equal(bizCodeOf(() => impactSchema.parseDecision({
    decision: 'UPHELD', reason: '   ', expectedTaskVersion: 1,
  })), 'VALIDATION_FAILED', '理由不得为空白');
});

test('清除入参：范围枚举、账号版本与未知字段', () => {
  assert.equal(clearanceSchema.parseScopeQuery({ scope: 'ALL' }), 'ALL');
  assert.equal(clearanceSchema.parseSubmitInput({
    scope: 'VENDOR_DATA', expectedAccountVersion: 5,
  }).expectedAccountVersion, 5);
  assert.equal(bizCodeOf(() => clearanceSchema.parseScopeQuery({ scope: 'EVERYTHING' })), 'VALIDATION_FAILED');
  assert.equal(bizCodeOf(() => clearanceSchema.parseScopeQuery({})), 'VALIDATION_FAILED');
  assert.equal(bizCodeOf(() => clearanceSchema.parseSubmitInput({
    scope: 'ALL', expectedAccountVersion: 1, force: true,
  })), 'VALIDATION_FAILED');
});

test('清除范围与受影响类别：ACCOUNT_DATA 不得牵动摊主资料', () => {
  assert.deepEqual(clearanceMapper.kindsOf('ACCOUNT_DATA'), ['ACCOUNT_PROFILE']);
  assert.deepEqual(clearanceMapper.kindsOf('VENDOR_DATA'), ['VENDOR_PROFILE', 'SESSION_LOCATIONS']);
  assert.deepEqual(clearanceMapper.kindsOf('ALL'), [
    'ACCOUNT_PROFILE', 'VENDOR_PROFILE', 'SESSION_LOCATIONS',
  ]);
});

test('清除结果投影：未完成且超期时写明原因，不虚报完成', () => {
  const row = {
    id: 7,
    account_id: 1,
    vendor_id: 2,
    scope_json: JSON.stringify({ requestedScope: 'ALL', effectiveScope: 'ALL', affectedKinds: ['ACCOUNT_PROFILE'] }),
    status: 'QUEUED',
    accepted_at_ms: SHANGHAI_2026_01_01_08_30,
    due_at_ms: SHANGHAI_2026_01_01_08_30 + 30 * DAY,
    completed_at_ms: null,
    result_summary_json: null,
  };
  const overdue = clearanceMapper.toRequestItem(row, { nowMs: row.due_at_ms + 1 });
  assert.equal(overdue.overdue, true);
  assert.ok(overdue.overdueReason, '超期必须给出原因');
  assert.equal(overdue.completedAtMs, null);
  const pending = clearanceMapper.toRequestItem(row, { nowMs: row.accepted_at_ms + 1000 });
  assert.equal(pending.overdue, undefined, '未超期不标记超期');
});

test('清除结果投影：完成时按已清除与必要保留分别表述', () => {
  const row = {
    id: 8,
    account_id: 1,
    vendor_id: 2,
    scope_json: JSON.stringify({ requestedScope: 'ALL', effectiveScope: 'ALL', affectedKinds: ['ALL'] }),
    status: 'COMPLETED',
    accepted_at_ms: SHANGHAI_2026_01_01_08_30,
    due_at_ms: SHANGHAI_2026_01_01_08_30 + 30 * DAY,
    completed_at_ms: SHANGHAI_2026_01_01_08_30 + HOUR,
    result_summary_json: JSON.stringify({
      hidden: [{ kind: 'PUBLIC_PUBLICATION', count: 1, basis: '按本人停止公开处理' }],
      cleared: [{ kind: 'ACCOUNT_PROFILE', count: 1 }],
      retained: [{ kind: 'MANAGEMENT_AUDIT', count: 2, basis: '1095 日', dueAtMs: 1 }],
      failures: [],
    }),
  };
  const item = clearanceMapper.toRequestItem(row, { nowMs: row.completed_at_ms });
  assert.deepEqual(item.processedKinds, ['ACCOUNT_PROFILE']);
  assert.equal(item.retainedKinds.length, 1);
  assert.equal(item.retainedKinds[0].kind, 'MANAGEMENT_AUDIT');
  assert.equal(item.failures.length, 0);
  assert.equal(item.overdue, undefined);
});

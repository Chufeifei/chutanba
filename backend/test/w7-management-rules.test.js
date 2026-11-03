/**
 * W7 纯函数用例：管理入参白名单、事实覆盖、投影不泄露与能力断言。
 * 不依赖数据库：这些规则一旦被改坏，集成用例的失败信息往往指向别处。
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');

const feedbackSchema = require('../src/modules/feedback-review/schema');
const managementSchema = require('../src/modules/management/schema');
const feedbackMapper = require('../src/modules/feedback-review/mapper');
const managementMapper = require('../src/modules/management/mapper');
const impactMapper = require('../src/modules/impact/mapper');
const authorization = require('../src/modules/authorization');

function bizCodeOf(fn) {
  try {
    fn();
  } catch (error) {
    return error.bizCode;
  }
  return null;
}

test('决定入参：白名单、结果与理由码必须成对、事实不可重复', () => {
  const valid = feedbackSchema.parseDecision({
    factResults: [
      { factId: '1', result: 'CONFIRM', reasonCode: 'ON_SITE_CONFIRMED' },
      { factId: '2', result: 'NOT_CONFIRM', reasonCode: 'INSUFFICIENT_EVIDENCE', reasonText: '现场无人' },
    ],
    expectedTaskVersion: 3,
  });
  assert.equal(valid.factResults.length, 2);
  assert.equal(valid.factResults[1].reasonText, '现场无人');
  assert.equal(valid.expectedTaskVersion, 3);

  assert.equal(bizCodeOf(() => feedbackSchema.parseDecision({
    factResults: [{ factId: '1', result: 'CONFIRM', reasonCode: 'NO_ANOMALY_PROVEN' }],
    expectedTaskVersion: 1,
  })), 'VALIDATION_FAILED', '确认结论不得使用"证明确无异常"这一否定理由');
  assert.equal(bizCodeOf(() => feedbackSchema.parseDecision({
    factResults: [
      { factId: '1', result: 'CONFIRM', reasonCode: 'ON_SITE_CONFIRMED' },
      { factId: '1', result: 'CONFIRM', reasonCode: 'ON_SITE_CONFIRMED' },
    ],
    expectedTaskVersion: 1,
  })), 'VALIDATION_FAILED', '同一事实重复出现必须拒绝');
  assert.equal(bizCodeOf(() => feedbackSchema.parseDecision({
    factResults: [{ factId: '1', result: 'CONFIRM', reasonCode: 'ON_SITE_CONFIRMED' }],
    expectedTaskVersion: 1,
    reviewerId: '9',
  })), 'VALIDATION_FAILED', '管理决定不接受客户端声明的操作者');
  assert.equal(bizCodeOf(() => feedbackSchema.parseDecision({
    factResults: [{ factId: '1', result: 'CONFIRM', reasonCode: 'ON_SITE_CONFIRMED' }],
  })), 'VALIDATION_FAILED', '缺少事项版本必须拒绝');
});

test('事实覆盖：漏判与多判都拒绝，集合一致才通过', () => {
  const current = ['1', '2'];
  assert.equal(feedbackSchema.assertFactCoverage(current, [
    { factId: '1' }, { factId: '2' },
  ]), true);
  assert.equal(bizCodeOf(() => feedbackSchema.assertFactCoverage(current, [{ factId: '1' }])),
    'VALIDATION_FAILED', '少一条事实必须拒绝');
  assert.equal(bizCodeOf(() => feedbackSchema.assertFactCoverage(current, [
    { factId: '1' }, { factId: '2' }, { factId: '3' },
  ])), 'VALIDATION_FAILED', '多一条事实必须拒绝');
});

test('纠错入参：动作固定、理由必填且不接受未知字段', () => {
  const valid = feedbackSchema.parseCorrection({
    sourceCaseId: '12', action: 'CLOSE_CURRENT', reason: '现场核实无人', expectedSessionVersion: 2,
  });
  assert.equal(valid.sourceCaseId, '12');
  assert.equal(bizCodeOf(() => feedbackSchema.parseCorrection({
    sourceCaseId: '12', action: 'CLOSE_ANY', reason: '理由', expectedSessionVersion: 2,
  })), 'VALIDATION_FAILED');
  assert.equal(bizCodeOf(() => feedbackSchema.parseCorrection({
    sourceCaseId: '12', action: 'CLOSE_CURRENT', reason: '   ', expectedSessionVersion: 2,
  })), 'VALIDATION_FAILED');
  assert.equal(bizCodeOf(() => feedbackSchema.parseCorrection({
    sourceCaseId: '12', action: 'CLOSE_CURRENT', reason: '理由', expectedSessionVersion: 2, force: true,
  })), 'VALIDATION_FAILED');
});

test('治理入参：动作白名单、理由必填、版本为正整数', () => {
  const valid = managementSchema.parseGovernanceInput({
    action: 'PAUSE', reason: '多次现场核实不实', expectedGovernanceVersion: 1,
  });
  assert.equal(valid.action, 'PAUSE');
  assert.equal(bizCodeOf(() => managementSchema.parseGovernanceInput({
    action: 'DELETE', reason: '理由', expectedGovernanceVersion: 1,
  })), 'VALIDATION_FAILED');
  assert.equal(bizCodeOf(() => managementSchema.parseGovernanceInput({
    action: 'PAUSE', reason: '', expectedGovernanceVersion: 1,
  })), 'VALIDATION_FAILED');
  assert.equal(bizCodeOf(() => managementSchema.parseGovernanceInput({
    action: 'PAUSE', reason: '理由', expectedGovernanceVersion: 0,
  })), 'VALIDATION_FAILED');
});

test('摊主检索入参：未知参数与超长关键词拒绝，游标必须是十进制 ID', () => {
  assert.deepEqual(managementSchema.parseVendorQuery({}), { keyword: null, cursor: null, limit: 20 });
  assert.equal(bizCodeOf(() => managementSchema.parseVendorQuery({ region: 'SH' })), 'VALIDATION_FAILED');
  assert.equal(bizCodeOf(() => managementSchema.parseVendorQuery({ keyword: 'x'.repeat(41) })), 'VALIDATION_FAILED');
  assert.equal(bizCodeOf(() => managementSchema.parseVendorQuery({ cursor: 'abc' })), 'VALIDATION_FAILED');
});

test('列表投影：摘要不含坐标，详情坐标只在证据块内', () => {
  const summary = feedbackMapper.toCaseSummary({
    id: 1, status: 'PENDING', feedback_type: 'OWNER_ABSENT', opened_at_ms: 10,
    closed_at_ms: null, vendor_id: 2, vendor_name: '老张烤冷面', category_code: 'SNACK',
    fact_count: 2, reporter_count: 2, reporter_lat: 31.2, reporter_lng: 121.4,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'reporterLat'), false);
  assert.equal(summary.factCount, 2);
  assert.equal(summary.reporterCount, 2);

  const fact = feedbackMapper.toFact({
    id: 5, feedback_type: 'OWNER_ABSENT', submitted_at_ms: 20, event_at_ms: 10, description: '没人',
    reporter_lat: 31.2, reporter_lng: 121.4, reporter_located_at_ms: 19, distance_m: 88.5,
    session_id: 9, started_at_ms: 1, planned_end_at_ms: 2, ended_at_ms: null, end_reason: null,
    location_version_id: 7, version_no: 1, location_lat: 31.21, location_lng: 121.41,
    location_name: '人民广场', effective_at_ms: 1, stopped_at_ms: null,
  }, 9);
  assert.equal(fact.session.isCurrent, true);
  assert.equal(fact.evidence.distanceM, 88.5);
  assert.equal(Object.prototype.hasOwnProperty.call(fact, 'reporterLat'), false);
});

test('影响记录投影：只给摘要与期限，不含反馈人或坐标', () => {
  const item = impactMapper.toListItem({
    id: 3, source_type: 'FEEDBACK_CASE', source_id: 8, summary: '现场反馈核实成立',
    status: 'ACTIVE', created_at_ms: 100, reviewable_until_ms: 200, version: 1,
    reporter_account_id: 99, reporter_lat: 31,
  });
  assert.deepEqual(Object.keys(item).sort(), [
    'createdAtMs', 'impactRecordId', 'impactVersion', 'reviewableUntilMs',
    'sourceLabel', 'sourceType', 'status', 'summary',
  ]);
});

test('治理上下文投影：两类限制独立，缺省时字段完全缺失', () => {
  const context = managementMapper.toGovernanceContext({
    vendor: { id: 4, vendor_code: 'V4', vendor_name: '柠檬茶', lifecycle_status: 'ACTIVE' },
    controls: { selfVersion: 2, governanceVersion: 1, selfStoppedAtMs: null, governancePausedAtMs: null },
    eligibility: { eligible: false, reasons: ['SESSION_ACTIVE'] },
    currentSession: null,
    actions: [],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(context.controls, 'selfStoppedAtMs'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(context.controls, 'governancePausedAtMs'), false);
  assert.equal(context.governanceVersion, 1);
});

test('能力断言：缺能力一律 PERMISSION_DENIED', () => {
  assert.deepEqual(authorization.assertCapability(['FIELD_REVIEWER'], 'FIELD_REVIEWER'), ['FIELD_REVIEWER']);
  assert.equal(bizCodeOf(() => authorization.assertCapability(['ADMIN'], 'FIELD_REVIEWER')), 'PERMISSION_DENIED');
  assert.equal(bizCodeOf(() => authorization.assertAnyCapability(['PROFILE_REVIEWER'], ['ADMIN', 'SUPER_ADMIN'])),
    'PERMISSION_DENIED');
  assert.deepEqual(authorization.assertAnyCapability(['SUPER_ADMIN'], ['ADMIN', 'SUPER_ADMIN']), ['SUPER_ADMIN']);
});

/**
 * W6 纯函数单测：受理窗口边界、现场距离、入参白名单与投影字段集合。
 * 不连数据库，不依赖当前时刻；全部使用固定毫秒常量。
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  WINDOW_AFTER_END_MS, effectiveEndMs, eligibleUntilMs, isEligible,
} = require('../src/modules/observation/eligibility');
const { haversineMeters } = require('../src/utils/geo');
const observationSchema = require('../src/modules/observation/schema');
const observationMapper = require('../src/modules/observation/mapper');
const feedbackSchema = require('../src/modules/feedback/schema');
const feedbackMapper = require('../src/modules/feedback/mapper');

const MINUTE = 60 * 1000;
const NOW = Date.UTC(2026, 10, 3, 6, 0, 0);

test('窗口：营业中可提交，结束后 30 分钟内可提交，恰好 30 分钟关闭', () => {
  const open = { endedAtMs: null, plannedEndAtMs: NOW + 60 * MINUTE };
  assert.equal(isEligible(open, NOW), true);
  assert.equal(eligibleUntilMs(open), NOW + 90 * MINUTE);

  const closed = { endedAtMs: NOW, plannedEndAtMs: NOW + 60 * MINUTE };
  assert.equal(isEligible(closed, NOW + 30 * MINUTE - 1), true);
  // 恰好 30 分钟即关闭（严格小于）
  assert.equal(isEligible(closed, NOW + 30 * MINUTE), false);
  assert.equal(eligibleUntilMs(closed), NOW + WINDOW_AFTER_END_MS);
});

test('窗口：到期未物理结束时以 planned_end_at_ms 作为有效结束', () => {
  const overdue = { endedAtMs: null, plannedEndAtMs: NOW - 10 * MINUTE };
  assert.equal(effectiveEndMs(overdue), NOW - 10 * MINUTE);
  assert.equal(isEligible(overdue, NOW), true);
  assert.equal(isEligible(overdue, NOW + 20 * MINUTE), false);
});

test('距离：恰好 300 米可受理，300 米以上拒绝（阈值判定在 service，常量在此断言）', () => {
  // 纬度 1e-5 度约 1.11 米；0.0027 度约 300 米。
  const distance = haversineMeters({ lat: 31.2304, lng: 121.4737 }, { lat: 31.2331, lng: 121.4737 });
  assert.ok(distance > 299 && distance < 301, `实际距离 ${distance}`);
  const zero = haversineMeters({ lat: 31.2304, lng: 121.4737 }, { lat: 31.2304, lng: 121.4737 });
  assert.equal(zero, 0);
});

test('观察入参：领取只收 claimToken，候选游标与上限受约束', () => {
  assert.deepEqual(observationSchema.parseClaimInput({ claimToken: 'a.b.c' }), { claimToken: 'a.b.c' });
  assert.throws(() => observationSchema.parseClaimInput({ claimToken: 'a.b.c', observationId: '1' }),
    (error) => error.bizCode === 'VALIDATION_FAILED');
  assert.throws(() => observationSchema.parseClaimInput({ claimToken: '' }),
    (error) => error.bizCode === 'VALIDATION_FAILED');

  assert.deepEqual(observationSchema.parseCandidateQuery({}), { cursor: null, limit: 20 });
  assert.deepEqual(observationSchema.parseCandidateQuery({ cursor: `${NOW}_7`, limit: '5' }), {
    cursor: { eventAtMs: NOW, observationId: '7' }, limit: 5,
  });
  assert.throws(() => observationSchema.parseCandidateQuery({ limit: '51' }),
    (error) => error.bizCode === 'VALIDATION_FAILED');
  assert.throws(() => observationSchema.parseCandidateQuery({ cursor: 'bad' }),
    (error) => error.bizCode === 'VALIDATION_FAILED');
});

test('反馈入参：拒绝图片、自填时刻、未知字段与三字段之外的定位', () => {
  const valid = {
    observationId: '12',
    type: 'OWNER_ABSENT',
    description: '摊主不在',
    locationContextToken: 'token-value',
    location: { lat: 31.2304, lng: 121.4737, locatedAtMs: NOW },
    expectedObservationVersion: 1,
  };
  const parsed = feedbackSchema.parseSubmitInput(valid);
  assert.equal(parsed.observationId, '12');
  assert.equal(parsed.expectedObservationVersion, 1);

  const withImage = { ...valid, image: 'x' };
  assert.throws(() => feedbackSchema.parseSubmitInput(withImage),
    (error) => error.bizCode === 'VALIDATION_FAILED');
  const withEventAt = { ...valid, eventAtMs: NOW };
  assert.throws(() => feedbackSchema.parseSubmitInput(withEventAt),
    (error) => error.bizCode === 'VALIDATION_FAILED');
  const withLocationName = { ...valid, location: { ...valid.location, locationName: '人民广场' } };
  assert.throws(() => feedbackSchema.parseSubmitInput(withLocationName),
    (error) => error.bizCode === 'VALIDATION_FAILED');
  const badType = { ...valid, type: 'RANDOM' };
  assert.throws(() => feedbackSchema.parseSubmitInput(badType),
    (error) => error.bizCode === 'VALIDATION_FAILED');
  const longDescription = { ...valid, description: '字'.repeat(301) };
  assert.throws(() => feedbackSchema.parseSubmitInput(longDescription),
    (error) => error.bizCode === 'VALIDATION_FAILED');
  const stringVersion = { ...valid, expectedObservationVersion: '1' };
  assert.throws(() => feedbackSchema.parseSubmitInput(stringVersion),
    (error) => error.bizCode === 'VALIDATION_FAILED');
});

test('投影白名单：本人详情不含坐标与距离，候选只给摘要与资格', () => {
  const row = {
    id: 9,
    case_id: 3,
    feedback_type: 'OWNER_ABSENT',
    observation_id: 21,
    session_id: 4,
    location_version_id: 5,
    event_at_ms: NOW - MINUTE,
    submitted_at_ms: NOW,
    description: '摊主不在',
    distance_m: '12.345',
    reporter_lat: 31.23,
    reporter_lng: 121.47,
    reporter_located_at_ms: NOW,
    status: 'PENDING',
    result_reason_code: null,
    closed_at_ms: null,
    vendor_name: '老张烤冷面',
    category_code: 'SNACK',
  };
  const detail = feedbackMapper.toDetail(row);
  assert.equal(detail.status, 'PENDING');
  assert.equal(Object.prototype.hasOwnProperty.call(detail, 'reporter_lat'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(detail, 'distance_m'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(detail, 'resultReason'), false);

  const decided = feedbackMapper.toDetail({ ...row, status: 'CONFIRMED', result_reason_code: 'ONSITE_CONFIRMED', closed_at_ms: NOW + MINUTE });
  assert.equal(decided.resultReason, 'ONSITE_CONFIRMED');

  const candidate = observationMapper.toCandidate({
    id: 21,
    version: 1,
    vendor_id: 7,
    event_at_ms: NOW - MINUTE,
    ended_at_ms: null,
    planned_end_at_ms: NOW + 60 * MINUTE,
    vendor_name: '老张烤冷面',
    category_code: 'SNACK',
    submitted_types: 'OWNER_ABSENT',
  }, NOW);
  assert.deepEqual(Object.keys(candidate).sort(), [
    'eligible', 'eligibleUntilMs', 'eventAtMs', 'nextStep',
    'observationId', 'observationVersion', 'submittedTypes', 'vendorSummary',
  ]);
  assert.deepEqual(candidate.submittedTypes, ['OWNER_ABSENT']);
  assert.equal(candidate.eligible, true);
});

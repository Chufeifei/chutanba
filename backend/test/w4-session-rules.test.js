/**
 * W4 纯函数单测：时间候选、阶段派生、上海时区、定位校验、入参归一化与游标。
 * 全部使用固定毫秒常量，不依赖运行机器时区与当前时刻。
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');

const time = require('../src/modules/session/time');
const geo = require('../src/modules/session/geo');
const schema = require('../src/modules/session/schema');

/** 只比较业务码：错误文案可能调整，bizCode 是契约。 */
function assertBiz(fn, code) {
  assert.throws(fn, (error) => error && error.bizCode === code, `期望 ${code}`);
}

const HOUR = 3_600_000;
const MINUTE = 60_000;
// 2026-11-03T06:42:30.123Z = 上海 11-03 14:42:30.123
const NOW = Date.UTC(2026, 10, 3, 6, 42, 30, 123);

test('上海日期与日内分钟按 UTC+8 换算', () => {
  assert.equal(time.shanghaiDateKey(NOW), '2026-11-03');
  assert.equal(time.shanghaiClockMin(NOW), 14 * 60 + 42);
  assert.equal(time.clockOnDate('2026-11-03', 14 * 60 + 42), Date.UTC(2026, 10, 3, 6, 42));
});

test('跨零点按当地日切开：UTC 16:00 属于次日', () => {
  const ms = Date.UTC(2026, 10, 3, 16, 0, 0);
  assert.equal(time.shanghaiDateKey(ms), '2026-11-04');
  assert.equal(time.shanghaiClockMin(ms), 0);
  assert.equal(time.addDays('2026-11-03', 1), '2026-11-04');
});

test('30 分钟向上取整：恰好边界不前进', () => {
  const exact = Date.UTC(2026, 10, 3, 11, 0, 0);
  assert.equal(time.roundUpToHalfHour(exact), exact);
  assert.equal(time.roundUpToHalfHour(exact + 1), exact + 30 * MINUTE);
  assert.equal(time.roundUpToHalfHour(exact - 1), exact);
});

test('无上次钟点时候选为 N+4h 向上取整', () => {
  const result = time.buildOpenTimeCandidates({ nowMs: NOW, lastSelectedClockMin: null });
  assert.equal(result.today, undefined);
  assert.equal(result.tomorrow, undefined);
  assert.equal(result.defaultCandidate.atMs, Date.UTC(2026, 10, 3, 11, 0, 0));
  assert.equal(result.defaultCandidate.label, 'FOUR_HOURS');
  assert.equal(result.defaultCandidate.dateKey, '2026-11-03');
  assert.equal(result.defaultCandidate.clockMin, 19 * 60);
});

test('有上次钟点时优先今天，超出 12 小时则回退', () => {
  const clockMin = 14 * 60 + 42;
  const today = time.buildOpenTimeCandidates({
    nowMs: Date.UTC(2026, 10, 3, 21, 0, 0), lastSelectedClockMin: clockMin,
  });
  assert.equal(today.today.atMs, Date.UTC(2026, 10, 4, 6, 42));
  assert.equal(today.defaultCandidate.label, 'TODAY');

  const fallback = time.buildOpenTimeCandidates({ nowMs: NOW, lastSelectedClockMin: clockMin });
  assert.equal(fallback.today, undefined);
  assert.equal(fallback.defaultCandidate.label, 'FOUR_HOURS');
  assert.equal(fallback.defaultCandidate.atMs, Date.UTC(2026, 10, 3, 11, 0, 0));
});

test('今天已过时用次日候选', () => {
  const result = time.buildOpenTimeCandidates({
    nowMs: Date.UTC(2026, 10, 4, 7, 0, 0), lastSelectedClockMin: 2 * 60,
  });
  assert.equal(result.today, undefined);
  assert.equal(result.tomorrow.atMs, Date.UTC(2026, 10, 4, 18, 0));
  assert.equal(result.defaultCandidate.label, 'TOMORROW');
});

test('结束时间必须晚于当前且不超过 12 小时', () => {
  assert.equal(time.validatePlannedEnd({ nowMs: NOW, plannedEndAtMs: NOW + HOUR }), NOW + HOUR);
  assert.equal(time.validatePlannedEnd({ nowMs: NOW, plannedEndAtMs: NOW + 12 * HOUR }), NOW + 12 * HOUR);
  assertBiz(() => time.validatePlannedEnd({ nowMs: NOW, plannedEndAtMs: NOW }), 'TIME_INVALID');
  assertBiz(() => time.validatePlannedEnd({ nowMs: NOW, plannedEndAtMs: NOW + 12 * HOUR + 1 }), 'TIME_INVALID');
  assertBiz(() => time.validatePlannedEnd({ nowMs: NOW, plannedEndAtMs: NOW + 0.5 }), 'TIME_INVALID');
});

test('阶段派生：准备期 25% 上限 60 分钟，R=T 归入 PREPARING', () => {
  const startedAtMs = NOW;
  const longSession = time.derivePhase({ nowMs: NOW + 1, startedAtMs, plannedEndAtMs: startedAtMs + 6 * HOUR });
  assert.equal(longSession.phase, 'OPEN');

  const boundary = time.derivePhase({
    nowMs: NOW + 5 * HOUR, startedAtMs, plannedEndAtMs: startedAtMs + 6 * HOUR,
  });
  assert.equal(boundary.phase, 'PREPARING');
  assert.equal(boundary.remainingMs, HOUR);

  const shortSession = time.derivePhase({
    nowMs: NOW + 46 * MINUTE, startedAtMs, plannedEndAtMs: startedAtMs + HOUR,
  });
  assert.equal(shortSession.phase, 'PREPARING');
  assert.equal(shortSession.remainingMs, 14 * MINUTE);
});

test('阶段派生：到期或无轮次为 RESTING', () => {
  assert.deepEqual(
    time.derivePhase({ nowMs: NOW, startedAtMs: NOW - HOUR, plannedEndAtMs: NOW }),
    { phase: 'RESTING', remainingMs: 0 },
  );
  assert.deepEqual(
    time.derivePhase({ nowMs: NOW, startedAtMs: null, plannedEndAtMs: null }),
    { phase: 'RESTING', remainingMs: 0 },
  );
});

test('定位：合法输入被裁剪并转换', () => {
  const location = geo.normalizeLocation({
    lat: 31.2304, lng: 121.4737, locationName: '  人民广场  ', locatedAtMs: NOW - 1000,
  }, { nowMs: NOW, issuedAtMs: NOW - 60_000 });
  assert.deepEqual(location, {
    lat: 31.2304, lng: 121.4737, locationName: '人民广场', locatedAtMs: NOW - 1000,
  });
});

test('定位：多余字段、越界坐标、控制字符与时间窗口被拒绝', () => {
  const base = { lat: 31.23, lng: 121.47, locationName: '人民广场', locatedAtMs: NOW - 1000 };
  const options = { nowMs: NOW, issuedAtMs: NOW - 60_000 };
  assertBiz(() => geo.normalizeLocation({ ...base, extra: 1 }, options), 'VALIDATION_FAILED');
  assertBiz(() => geo.normalizeLocation({ ...base, lat: 91 }, options), 'LOCATION_INVALID');
  assertBiz(() => geo.normalizeLocation({ ...base, lng: -181 }, options), 'LOCATION_INVALID');
  assertBiz(() => geo.normalizeLocation({ ...base, locationName: 'a\u0000b' }, options), 'LOCATION_INVALID');
  assertBiz(() => geo.normalizeLocation({ ...base, locationName: '   ' }, options), 'LOCATION_INVALID');
  assertBiz(() => geo.normalizeLocation({ ...base, locatedAtMs: NOW - 5 * MINUTE - 1 }, options), 'LOCATION_INVALID');
  assertBiz(() => geo.normalizeLocation({ ...base, locatedAtMs: NOW + 1 }, options), 'LOCATION_INVALID');
  assertBiz(() => geo.normalizeLocation({ ...base, locatedAtMs: NOW - 120_000 }, options), 'LOCATION_INVALID');
});

test('游标编解码可往返，非法游标被拒绝', () => {
  const cursor = schema.encodeCursor({ openDate: '2026-11-03', id: '42' });
  assert.deepEqual(schema.decodeCursor(cursor), { openDate: '2026-11-03', id: '42' });
  assertBiz(() => schema.decodeCursor('%%%'), 'VALIDATION_FAILED');
  assertBiz(() => schema.decodeCursor(Buffer.from('{"d":"x"}').toString('base64url')), 'VALIDATION_FAILED');
});

test('出摊日分页参数：默认 20、上限 100', () => {
  assert.deepEqual(schema.normalizeOpenDaysQuery({}), { limit: 20, cursor: null });
  assert.equal(schema.normalizeOpenDaysQuery({ limit: '100' }).limit, 100);
  assertBiz(() => schema.normalizeOpenDaysQuery({ limit: '101' }), 'VALIDATION_FAILED');
  assertBiz(() => schema.normalizeOpenDaysQuery({ limit: '0' }), 'VALIDATION_FAILED');
});

test('开摊入参白名单与 ID 归一化', () => {
  assert.equal(schema.assertPathId('000123'), '123');
  assertBiz(() => schema.assertPathId('0'), 'VALIDATION_FAILED');
  assertBiz(() => schema.assertPathId('12a'), 'VALIDATION_FAILED');

  const location = { lat: 31.23, lng: 121.47, locationName: '人民广场', locatedAtMs: NOW - 1000 };
  const input = schema.normalizeOpenSession({
    attemptId: '7',
    plannedEndAtMs: NOW + HOUR,
    locationContextToken: 'token_abcdefgh',
    location,
    expectedVendorVersion: 3,
  });
  assert.equal(input.attemptId, '7');
  assert.equal(input.expectedVendorVersion, 3);

  assertBiz(() => schema.normalizeOpenSession({
    attemptId: '7',
    plannedEndAtMs: NOW + HOUR,
    locationContextToken: 'token_abcdefgh',
    location,
    expectedVendorVersion: 3,
    extra: true,
  }), 'VALIDATION_FAILED');
  // W6 起 FEEDBACK 是合法用途（顾客侧现场反馈），这里改为断言未定义用途仍被拒绝。
  assert.deepEqual(
    schema.normalizeIssueContext({ purpose: 'FEEDBACK', targetId: '1' }),
    { purpose: 'FEEDBACK', targetId: '1' },
  );
  assertBiz(() => schema.normalizeIssueContext({ purpose: 'ARBITRARY', targetId: '1' }), 'VALIDATION_FAILED');
  assert.deepEqual(schema.normalizeAttemptFinish({ outcome: 'CANCELLED' }), { outcome: 'CANCELLED' });
  assertBiz(() => schema.normalizeAttemptFinish({ outcome: 'SUCCEEDED' }), 'VALIDATION_FAILED');
});

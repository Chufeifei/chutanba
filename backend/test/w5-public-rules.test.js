/**
 * W5 纯函数单测：品类目录一致性、资格三态、投影白名单、入参拒绝与匿名令牌。
 * 不连数据库，不依赖当前时刻；全部使用固定毫秒常量。
 */
const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.PUBLIC_TOKEN_SECRET = 'w5-unit-secret';
process.env.PUBLIC_SESSION_TTL_MS = '1800000';

const miniprogramCategories = require('../../miniprogram/config/categories');
const categories = require('../src/modules/discovery/categories');
const schema = require('../src/modules/discovery/schema');
const mapper = require('../src/modules/discovery/mapper');
const anonymous = require('../src/modules/discovery/anonymous');
const env = require('../src/config/env');
const { describeAvailability, isPubliclyVisible } = require('../src/modules/discovery/service/qualify');

const NOW = Date.UTC(2026, 10, 3, 6, 42, 30, 123);

function assertBiz(fn, code) {
  assert.throws(fn, (error) => error && error.bizCode === code, `期望 ${code}`);
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

test('公开品类目录与小程序 25 个码完全一致', () => {
  assert.equal(categories.CATEGORIES.length, 25);
  assert.equal(miniprogramCategories.CATEGORY_ITEMS.length, 25);
  const backend = categories.CATEGORIES.map((item) => `${item.code}|${item.name}|${item.defaultVisual}`);
  const client = miniprogramCategories.CATEGORY_ITEMS.map(
    (item) => `${item.code}|${item.name}|${item.emoji}`,
  );
  assert.deepEqual(backend, client);
  assert.equal(categories.isCategoryCode('SNACK'), true);
  assert.equal(categories.isCategoryCode('FOOD'), false);
  assert.equal(categories.isCategoryCode(undefined), false);
});

test('资格三态：资料、限制、轮次、时间窗与位置缺一不可', () => {
  const openRow = {
    vendor_id: 1,
    lifecycle_status: 'ACTIVE',
    active_profile_version_id: 7,
    self_stopped_at_ms: null,
    governance_paused_at_ms: null,
    session_id: 11,
    started_at_ms: NOW - 60_000,
    planned_end_at_ms: NOW + 60_000,
    ended_at_ms: null,
    location_id: 21,
    stopped_at_ms: null,
  };
  assert.equal(describeAvailability(openRow, NOW), 'OPEN');
  assert.equal(isPubliclyVisible(openRow, NOW), true);
  // 边界：S 与 N 相等仍可见，E 与 N 相等即休息（S ≤ N < E）。
  assert.equal(describeAvailability(openRow, NOW - 60_000), 'OPEN');
  assert.equal(describeAvailability(openRow, NOW + 60_000), 'RESTING');
  assert.equal(describeAvailability(null, NOW), 'UNVIEWABLE');
  assert.equal(describeAvailability({ ...openRow, active_profile_version_id: null }, NOW), 'UNVIEWABLE');
  assert.equal(describeAvailability({ ...openRow, self_stopped_at_ms: 5 }, NOW), 'UNVIEWABLE');
  assert.equal(describeAvailability({ ...openRow, governance_paused_at_ms: 5 }, NOW), 'UNVIEWABLE');
  assert.equal(describeAvailability({ ...openRow, lifecycle_status: 'DELETED' }, NOW), 'UNVIEWABLE');
  assert.equal(describeAvailability({ ...openRow, session_id: null }, NOW), 'RESTING');
  assert.equal(describeAvailability({ ...openRow, location_id: null }, NOW), 'RESTING');
  assert.equal(describeAvailability({ ...openRow, stopped_at_ms: 5 }, NOW), 'RESTING');
});

test('列表投影只含契约字段，有定位才出现 distanceM', () => {
  const row = {
    vendor_id: 5,
    vendor_name: '烤冷面',
    category_code: 'SNACK',
    regular_items_text: '烤冷面、手抓饼',
    planned_end_at_ms: NOW + 3_600_000,
    located_at_ms: NOW - 60_000,
    lat: '31.2304000',
    lng: '121.4737000',
    location_name: '人民广场',
  };
  const item = mapper.toPublicListItem(row, { phase: 'OPEN' });
  assert.deepEqual(sortedKeys(item), [
    'categoryCode', 'currentLocation', 'lastLocatedAtMs', 'name',
    'phase', 'plannedEndAtMs', 'regularItemsSummary', 'vendorId',
  ]);
  assert.equal(item.vendorId, '5');
  assert.equal(item.currentLocation.lat, 31.2304);
  const withDistance = mapper.toPublicListItem(row, { phase: 'OPEN', distanceM: 123.4 });
  assert.equal(withDistance.distanceM, 123.4);
});

test('详情三态字段：休息与不可查看不出现坐标或轮次摘要', () => {
  const row = {
    vendor_id: 5,
    vendor_name: '烤冷面',
    category_code: 'SNACK',
    regular_items_text: '烤冷面',
    price_description: '10 元',
    announcement: '每晚 6 点',
    session_id: 11,
    location_id: 21,
    started_at_ms: NOW - 60_000,
    planned_end_at_ms: NOW + 2_000_000,
    lat: '31.2304000',
    lng: '121.4737000',
    location_name: '人民广场',
    located_at_ms: NOW - 60_000,
  };
  const phaseInfo = { phase: 'OPEN', remainingMs: 2_000_000 };
  const open = mapper.toPublicDetail(row, { availability: 'OPEN', phaseInfo, serverNowMs: NOW });
  assert.deepEqual(sortedKeys(open), [
    'availability', 'currentLocation', 'profile', 'serverNowMs',
    'sessionSummary', 'vendorId',
  ]);
  assert.equal(open.profile.name, '烤冷面');
  assert.deepEqual(sortedKeys(open.sessionSummary), [
    'locationVersionId', 'phase', 'plannedEndAtMs', 'remainingMs', 'sessionId', 'startedAtMs',
  ]);
  assert.equal(open.sessionSummary.sessionId, '11');
  assert.equal(open.sessionSummary.locationVersionId, '21');

  const resting = mapper.toPublicDetail(row, { availability: 'RESTING', serverNowMs: NOW });
  assert.deepEqual(sortedKeys(resting), ['availability', 'profile', 'serverNowMs', 'vendorId']);
  assert.equal('currentLocation' in resting, false);
  assert.equal('sessionSummary' in resting, false);

  const hidden = mapper.toPublicDetail(null, { availability: 'UNVIEWABLE', vendorId: '999', serverNowMs: NOW });
  assert.deepEqual(sortedKeys(hidden), ['availability', 'notice', 'serverNowMs', 'vendorId']);
  assert.equal(hidden.notice, '该摊位当前暂不可查看');
});

test('观察投影含领取令牌但不含坐标；导航复核按决定分支裁剪字段', () => {
  const base = {
    observationId: 3, eventAtMs: NOW, eventPublicStatus: 'OPEN',
    vendorId: 5, vendorName: '烤冷面', categoryCode: 'SNACK',
    sessionId: 11, locationVersionId: 21, phase: 'OPEN',
  };
  const anonymousView = mapper.toObservationView({ ...base, claimToken: 'claim-token' });
  assert.deepEqual(sortedKeys(anonymousView), [
    'claimToken', 'eventAtMs', 'eventPublicStatus', 'observationId',
    'sessionSummary', 'vendorSummary',
  ]);
  assert.equal('currentLocation' in anonymousView, false);
  const identified = mapper.toObservationView({ ...base, claimToken: null });
  assert.equal('claimToken' in identified, false);

  const confirm = mapper.toNavigationCheckView({
    navigationCheckId: 9, decision: 'CONFIRM_REQUIRED', observationId: 3,
    expiresAtMs: NOW + 10, plannedEndAtMs: NOW + 120_000, remainingMs: 120_000,
    sessionId: 11, locationVersionId: 21,
  });
  assert.deepEqual(sortedKeys(confirm), [
    'decision', 'expiresAtMs', 'navigationCheckId', 'observationId', 'plannedEndAtMs', 'remainingMs',
  ]);
  assert.equal('currentLocation' in confirm, false);
  assert.equal('sessionId' in confirm, false);

  const ready = mapper.toNavigationCheckView({
    navigationCheckId: 9, decision: 'READY', observationId: 3,
    expiresAtMs: NOW + 10, plannedEndAtMs: NOW + 120_000, remainingMs: 120_000,
    sessionId: 11, locationVersionId: 21, claimToken: 'claim-token',
  });
  assert.deepEqual(sortedKeys(ready), [
    'claimToken', 'decision', 'expiresAtMs', 'locationVersionId',
    'navigationCheckId', 'observationId', 'sessionId',
  ]);
  assert.equal(ready.locationVersionId, '21');

  const launch = mapper.toLaunchView({
    launchId: 'l1', recordedAtMs: NOW, sessionId: 11, locationVersionId: 21, row: null,
  });
  assert.deepEqual(sortedKeys(launch), ['launchId', 'locationVersionId', 'recordedAtMs', 'sessionId']);
});

test('入参白名单：拒绝区域半径、未知字段、客户端时刻与非法坐标', () => {
  assert.deepEqual(schema.parseSearchInput(undefined), { categoryCode: null, viewerLocation: null });
  assert.deepEqual(schema.parseSearchInput({}), { categoryCode: null, viewerLocation: null });
  assert.deepEqual(
    schema.parseSearchInput({ categoryCode: 'SNACK', viewerLocation: { lat: 31.2, lng: 121.4 } }),
    { categoryCode: 'SNACK', viewerLocation: { lat: 31.2, lng: 121.4 } },
  );
  assertBiz(() => schema.parseSearchInput({ regionId: 1 }), 'VALIDATION_FAILED');
  assertBiz(() => schema.parseSearchInput({ radiusM: 500 }), 'VALIDATION_FAILED');
  assertBiz(() => schema.parseSearchInput({ categoryCode: 'FOOD' }), 'VALIDATION_FAILED');
  assertBiz(() => schema.parseSearchInput({ viewerLocation: { lat: 31.2 } }), 'VALIDATION_FAILED');
  assertBiz(() => schema.parseSearchInput({ viewerLocation: { lat: 91, lng: 0 } }), 'VALIDATION_FAILED');
  assertBiz(() => schema.parseSearchInput({ viewerLocation: { lat: 0, lng: 181 } }), 'VALIDATION_FAILED');

  assert.deepEqual(
    schema.parseObservationInput({ source: 'DETAIL', sessionId: '11', locationVersionId: '21' }),
    { source: 'DETAIL', sessionId: '11', locationVersionId: '21' },
  );
  assertBiz(() => schema.parseObservationInput({ source: 'DETAIL', sessionId: '11', locationVersionId: '21', eventAtMs: NOW }), 'VALIDATION_FAILED');
  assertBiz(() => schema.parseObservationInput({ source: 'NAVIGATION', sessionId: '11', locationVersionId: '21' }), 'VALIDATION_FAILED');
  assertBiz(() => schema.parseObservationInput({ source: 'DETAIL', sessionId: '0', locationVersionId: '21' }), 'VALIDATION_FAILED');

  assert.deepEqual(schema.parseNavigationCheckInput({}), {
    expectedSessionId: null, expectedLocationVersionId: null,
    confirmPrepared: false, confirmProvided: false,
  });
  assertBiz(() => schema.parseNavigationCheckInput({ confirmPrepared: 'yes' }), 'VALIDATION_FAILED');
  assertBiz(() => schema.parseNavigationCheckInput({ vendorId: '5' }), 'VALIDATION_FAILED');
  assertBiz(() => schema.parseLaunchInput({}), 'VALIDATION_FAILED');
});

test('匿名令牌可校验、可过期、可防篡改；领取令牌可重算', () => {
  const token = anonymous.issueToken(NOW);
  assert.equal(anonymous.verifyToken(token, NOW + 60_000), true);
  assert.equal(anonymous.verifyToken(token, NOW + 31 * 60_000), false);
  assert.equal(anonymous.verifyToken(`${token}x`, NOW), false);
  assert.equal(anonymous.verifyToken('not-a-token', NOW), false);
  assert.equal(anonymous.verifyToken(token, NOW - 120_000), false);
  assert.equal(anonymous.hashToken(token), anonymous.hashToken(token));
  assert.equal(anonymous.hashToken(token).length, 64);

  const claim = anonymous.computeClaimToken({ observationId: 3, eventAtMs: NOW });
  assert.equal(claim.startsWith(`3.${NOW}.`), true);
  assert.equal(anonymous.computeClaimToken({ observationId: 3, eventAtMs: NOW }), claim);

  const savedSecret = env.publicTokens.secret;
  env.publicTokens.secret = null;
  assertBiz(() => anonymous.issueToken(NOW), 'SERVICE_UNAVAILABLE');
  assert.equal(anonymous.hasSecret(), false);
  env.publicTokens.secret = savedSecret;
});

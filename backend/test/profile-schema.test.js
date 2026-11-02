const assert = require('node:assert/strict');
const test = require('node:test');

const schema = require('../src/modules/profile/schema');
const categories = require('../src/modules/profile/categories');

function submission(overrides = {}) {
  return {
    vendorName: '老王煎饼',
    categoryCode: 'PANCAKE',
    regularItemsText: '煎饼果子、豆浆',
    priceDescription: '煎饼 8 元起',
    announcement: '工作日早上六点出摊',
    expectedVendorVersion: 0,
    ...overrides,
  };
}

function assertInvalid(run, field, reason) {
  assert.throws(run, (error) => error.name === 'DomainError' &&
    error.bizCode === 'VALIDATION_FAILED' &&
    Array.isArray(error.data && error.data.fields) &&
    error.data.fields.some((item) => item.field === field && (reason === undefined || item.reason === reason)));
}

function assertSubmissionInvalid(field, reason, overrides) {
  assertInvalid(() => schema.normalizeSubmission(submission(overrides)), field, reason);
}

test('valid submission is trimmed and keeps the five contracts fields', () => {
  const input = schema.normalizeSubmission(submission({
    vendorName: '  老王煎饼  ', regularItemsText: ' 煎饼、豆浆 ',
  }));
  assert.equal(input.vendorName, '老王煎饼');
  assert.equal(input.regularItemsText, '煎饼、豆浆');
  assert.equal(input.categoryCode, 'PANCAKE');
  assert.equal(input.expectedVendorVersion, 0);
});

test('field length boundaries follow Unicode code points', () => {
  assert.doesNotThrow(() => schema.normalizeSubmission(submission({ vendorName: 'a'.repeat(40) })));
  assertSubmissionInvalid('vendorName', 'TOO_LONG', { vendorName: 'a'.repeat(41) });
  assert.doesNotThrow(() => schema.normalizeSubmission(submission({ regularItemsText: 'a'.repeat(200) })));
  assertSubmissionInvalid('regularItemsText', 'TOO_LONG', { regularItemsText: 'a'.repeat(201) });
  assert.doesNotThrow(() => schema.normalizeSubmission(submission({ priceDescription: 'a'.repeat(120) })));
  assertSubmissionInvalid('priceDescription', 'TOO_LONG', { priceDescription: 'a'.repeat(121) });
  assert.doesNotThrow(() => schema.normalizeSubmission(submission({ announcement: 'a'.repeat(300) })));
  assertSubmissionInvalid('announcement', 'TOO_LONG', { announcement: 'a'.repeat(301) });
});

test('emoji are counted by code point, not UTF-16 length', () => {
  assert.doesNotThrow(() => schema.normalizeSubmission(submission({ vendorName: '😀'.repeat(40) })));
  assertSubmissionInvalid('vendorName', 'TOO_LONG', { vendorName: '😀'.repeat(41) });
});

test('blank, control and markup characters are rejected', () => {
  assertSubmissionInvalid('vendorName', 'EMPTY', { vendorName: '   ' });
  assertSubmissionInvalid('announcement', 'CONTROL_CHARACTER', { announcement: '今天\u0000出摊' });
  assertSubmissionInvalid('regularItemsText', 'CONTROL_CHARACTER', { regularItemsText: 'abc\u009F' });
  assertSubmissionInvalid('priceDescription', 'INVALID_CHARACTER', { priceDescription: '<b>8元</b>' });
  assertSubmissionInvalid('announcement', 'INVALID_CHARACTER', { announcement: '价格 > 10 元' });
});

test('unknown fields and unknown category codes fail without mapping to OTHER', () => {
  assertSubmissionInvalid('nickname', 'UNKNOWN_FIELD', { nickname: '老王' });
  assertSubmissionInvalid('categoryCode', 'UNKNOWN_CATEGORY', { categoryCode: 'UNKNOWN_CODE' });
  assertSubmissionInvalid('categoryCode', 'UNKNOWN_CATEGORY', { categoryCode: 'other' });
});

test('expectedVendorVersion must be a non-negative safe integer', () => {
  for (const value of [undefined, -1, 1.5, '0', true]) {
    assertSubmissionInvalid('expectedVendorVersion', 'OUT_OF_RANGE', { expectedVendorVersion: value });
  }
  assert.doesNotThrow(() => schema.normalizeSubmission(submission({ expectedVendorVersion: 12 })));
});

test('decision input enforces enum, mandatory reject reason and length', () => {
  assert.doesNotThrow(() => schema.normalizeDecision({ decision: 'APPROVE', expectedTaskVersion: 1 }));
  assertInvalid(() => schema.normalizeDecision({ decision: 'REJECT', expectedTaskVersion: 1 }), 'reason', 'REQUIRED');
  assertInvalid(() => schema.normalizeDecision({ decision: 'REJECT', reason: '   ', expectedTaskVersion: 1 }), 'reason', 'REQUIRED');
  assert.doesNotThrow(() => schema.normalizeDecision({
    decision: 'REJECT', reason: 'a'.repeat(500), expectedTaskVersion: 0,
  }));
  assertInvalid(() => schema.normalizeDecision({
    decision: 'REJECT', reason: 'a'.repeat(501), expectedTaskVersion: 1,
  }), 'reason', 'TOO_LONG');
  assertInvalid(() => schema.normalizeDecision({
    decision: 'REJECT', reason: '资料\u0000不完整', expectedTaskVersion: 1,
  }), 'reason', 'CONTROL_CHARACTER');
  assertInvalid(() => schema.normalizeDecision({
    decision: 'REJECT', reason: '见<b>说明</b>', expectedTaskVersion: 1,
  }), 'reason', 'INVALID_CHARACTER');
  assertInvalid(() => schema.normalizeDecision({ decision: 'HOLD', expectedTaskVersion: 1 }), 'decision', 'ENUM');
  assertInvalid(() => schema.normalizeDecision({ decision: 'APPROVE', expectedTaskVersion: -1 }), 'expectedTaskVersion');
  assertInvalid(() => schema.normalizeDecision({
    decision: 'APPROVE', expectedTaskVersion: 1, extra: true,
  }), 'extra', 'UNKNOWN_FIELD');
});

test('submission id is a positive decimal string within the safe integer range', () => {
  assert.equal(schema.assertSubmissionId('42'), 42);
  for (const value of [0, -1, '0', '-1', '1.5', 'abc', '', 42, '9007199254740992']) {
    assertInvalid(() => schema.assertSubmissionId(value), 'id');
  }
});

test('review query defaults, cursor round-trip and status binding', () => {
  assert.deepEqual(schema.normalizeReviewQuery({}), { status: 'PENDING', limit: 20, cursor: null });
  const cursor = schema.encodeReviewCursor({ status: 'PENDING', submittedAtMs: 100, id: 9 });
  const parsed = schema.normalizeReviewQuery({ status: 'PENDING', cursor, limit: '100' });
  assert.deepEqual(parsed.cursor, { status: 'PENDING', submittedAtMs: 100, id: 9 });
  assert.equal(parsed.limit, 100);
  assertInvalid(() => schema.normalizeReviewQuery({ status: 'APPROVED', cursor }), 'cursor', 'STATUS_MISMATCH');
  assertInvalid(() => schema.normalizeReviewQuery({ status: 'UNKNOWN' }), 'status', 'ENUM');
  assertInvalid(() => schema.normalizeReviewQuery({ limit: '101' }), 'limit', 'OUT_OF_RANGE');
  assertInvalid(() => schema.normalizeReviewQuery({ limit: '0' }), 'limit', 'OUT_OF_RANGE');
  assertInvalid(() => schema.normalizeReviewQuery({ unexpected: '1' }), 'unexpected', 'UNKNOWN_FIELD');
});

test('backend category catalog matches the miniprogram frozen list', () => {
  const miniprogram = require('../../miniprogram/config/categories.js');
  const expected = miniprogram.CATEGORY_ITEMS.map((item) => item.code).sort();
  assert.equal(categories.CATEGORY_CODES.length, 25);
  assert.deepEqual([...categories.CATEGORY_CODES].sort(), expected);
});

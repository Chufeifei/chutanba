const assert = require('node:assert/strict');
const test = require('node:test');

const { assertIdempotencyKey } = require('../src/modules/operation/schema');
const { canonicalJson, sha256Hex } = require('../src/utils/digest');

test('idempotency keys accept the contracted character set', () => {
  for (const key of ['a', 'A1._:-', 'x'.repeat(64)]) {
    assert.equal(assertIdempotencyKey(key), key);
  }
});

test('idempotency keys reject empty, oversized and unsafe values', () => {
  for (const key of ['', 'with space', 'slash/key', 'x'.repeat(65), null, 42]) {
    assert.throws(() => assertIdempotencyKey(key), (error) => error.bizCode === 'VALIDATION_FAILED');
  }
});

test('canonical JSON is independent of object key order', () => {
  assert.equal(
    canonicalJson({ b: { d: 3, c: 2 }, a: 1 }),
    canonicalJson({ a: 1, b: { c: 2, d: 3 } }),
  );
});

test('canonical JSON keeps array order significant', () => {
  assert.notEqual(canonicalJson({ items: [1, 2] }), canonicalJson({ items: [2, 1] }));
});

test('canonical JSON rejects values that are not JSON-safe', () => {
  assert.throws(() => canonicalJson({ missing: undefined }), TypeError);
  assert.throws(() => canonicalJson({ infinite: Number.POSITIVE_INFINITY }), TypeError);
  assert.throws(() => canonicalJson({ callback: () => {} }), TypeError);
});

test('sha256 digest is stable for equal normalized requests', () => {
  const first = sha256Hex(canonicalJson({ b: 2, a: 1 }));
  const second = sha256Hex(canonicalJson({ a: 1, b: 2 }));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
});

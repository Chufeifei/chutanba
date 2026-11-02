const assert = require('node:assert/strict');
const test = require('node:test');

let verifier = {};
try { verifier = require('../scripts/verify-phase1-schema'); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const { readConfig, verifyPhase1Schema } = verifier;

test('verifier rejects application schema and missing isolation confirmation', () => {
  assert.equal(typeof readConfig, 'function');
  const base = {
    PHASE1_TEST_DATABASE: 'phase1_test_w1',
    PHASE1_TEST_MYSQL_VERSION: '8.0.30-cynos-3.1.19.002',
    PHASE1_TEST_USER: 'test_user',
    PHASE1_TEST_PASSWORD: 'test_password',
  };
  assert.throws(() => readConfig({ ...base, PHASE1_TEST_ISOLATED: 'YES', PHASE1_TEST_DATABASE: 'chutanba' }), /phase1_test_/);
  assert.throws(() => readConfig(base), /PHASE1_TEST_ISOLATED/);
});

test('live verifier checks migrations and database constraints on the isolated schema', {
  skip: !process.env.PHASE1_TEST_DATABASE,
}, async () => {
  const result = await verifyPhase1Schema(readConfig(process.env));
  assert.equal(result.database, 'phase1_test_w1');
  for (const check of [
    'empty-schema', 'repeat-migration', 'checksum-drift', 'table-contract',
    'active-profile-unique', 'active-session-unique', 'active-location-unique',
    'decimal-and-checks', 'coordinate-boundaries', 'large-integer',
    'bigint-metadata', 'unicode-roundtrip', 'binary-identity',
  ]) assert.ok(result.checks.includes(check), `missing check: ${check}`);
});

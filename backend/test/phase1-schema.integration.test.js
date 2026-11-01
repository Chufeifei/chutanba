const test = require('node:test');
const assert = require('node:assert/strict');
const { readTestConfig, verifyPhase1Schema } = require('../scripts/verify-phase1-schema');

test('verification requires explicit isolated configuration and never falls back to application DB', () => {
  assert.equal(readTestConfig({ DB_NAME: 'production' }).reason, 'PHASE1_TEST_DATABASE is not configured');
  assert.throws(() => readTestConfig({ PHASE1_TEST_DATABASE: 'production' }), /phase1_test_/);
  assert.throws(() => readTestConfig({ PHASE1_TEST_DATABASE: 'phase1_test_w1' }), /ISOLATED/);
  assert.throws(() => readTestConfig({ PHASE1_TEST_DATABASE: 'phase1_test_w1', PHASE1_TEST_ISOLATED: 'YES' }), /VERSION/);
  const config = readTestConfig({ PHASE1_TEST_DATABASE: 'phase1_test_w1', PHASE1_TEST_ISOLATED: 'YES', PHASE1_TEST_MYSQL_VERSION: '8.0.36', PHASE1_TEST_USER: 'tester' });
  assert.equal(config.connection.bigNumberStrings, true);
  assert.equal(config.connection.supportBigNumbers, true);
  assert.equal(config.connection.decimalNumbers, false);
});

const config = readTestConfig(process.env);
test('isolated target MySQL: migration, drift, concurrency, types and CHECK enforcement', {
  skip: config.reason || false,
  timeout: 120000
}, async t => {
  await verifyPhase1Schema(config, {
    check: (name, fn) => t.test(name, fn),
    report: evidence => t.diagnostic(JSON.stringify(evidence))
  });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1-runner-'));
fs.writeFileSync(path.join(fixture, '0002_test.js'), "module.exports = { statements: ['CREATE TABLE fixture_three (id INT)'] };");
fs.writeFileSync(path.join(fixture, '0001_test.js'), "module.exports = { statements: ['CREATE TABLE fixture_one (id INT)', 'CREATE TABLE fixture_two (id INT)'] };");
const options = { directory: fixture };
test.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
const { runPhase1Migrations, phase1MigrationStatus, loadPhase1Migrations } = require('../src/database/phase1/migration-runner');

function database({ tables = [], lock = 1, failStatement = false, failUnlock = false } = {}) {
  const state = { tables: [...tables], rows: [], executed: [], lock, failStatement, released: false, unlocks: 0, failUnlock };
  const conn = {
    async query(sql, params = []) {
      if (/GET_LOCK/i.test(sql)) return [[{ acquired: state.lock }]];
      if (/RELEASE_LOCK/i.test(sql)) { state.unlocks++; if (state.failUnlock) throw new Error('unlock broke'); return [[{ released: 1 }]]; }
      if (/SET time_zone/i.test(sql)) return [[]];
      if (/information_schema\.tables/i.test(sql)) return [state.tables.map(table_name => ({ table_name }))];
      if (/CREATE TABLE IF NOT EXISTS cb_phase1_schema_migrations/i.test(sql)) { if (!state.tables.includes('cb_phase1_schema_migrations')) state.tables.push('cb_phase1_schema_migrations'); return [[]]; }
      if (/SELECT .* FROM cb_phase1_schema_migrations/i.test(sql)) return [state.rows.map(row => ({ ...row }))];
      if (/INSERT INTO cb_phase1_schema_migrations/i.test(sql)) { state.rows.push({ name: params[0], checksum: params[1], status: 'RUNNING' }); return [[]]; }
      if (/UPDATE cb_phase1_schema_migrations/i.test(sql)) { state.rows.find(row => row.name === params[0]).status = 'APPLIED'; return [[]]; }
      if (state.failStatement && state.executed.length === 1) throw new Error('DDL broke');
      state.executed.push(sql); return [[]];
    },
    release() { state.released = true; }
  };
  return { state, async getConnection() { return conn; } };
}

test('empty schema migrates in order and repeat run is a no-op', async () => {
  const pool = database();
  const migrations = loadPhase1Migrations(fixture);
  await runPhase1Migrations(pool, options);
  assert.deepEqual(pool.state.rows.map(row => row.name), migrations.map(m => m.name));
  assert.deepEqual(pool.state.executed, ['CREATE TABLE fixture_one (id INT)', 'CREATE TABLE fixture_two (id INT)', 'CREATE TABLE fixture_three (id INT)']);
  assert.equal(pool.state.unlocks, 1);
  const count = pool.state.executed.length;
  await runPhase1Migrations(pool, options);
  assert.equal(pool.state.executed.length, count);
  const status = await phase1MigrationStatus(pool, options);
  assert.equal(status.compatible, true);
  assert.equal(status.pending.length, 0);
  assert.equal(status.drift.length, 0);
});

test('rejects nonempty schema before metadata bootstrap', async () => {
  const pool = database({ tables: ['legacy_table'] });
  await assert.rejects(runPhase1Migrations(pool, options), /non.?empty/i);
  assert.deepEqual(pool.state.tables, ['legacy_table']);
});

test('detects checksum drift before applying pending migrations', async () => {
  const pool = database();
  await runPhase1Migrations(pool, options);

  pool.state.rows.pop();
  pool.state.rows[0].checksum = 'changed';
  assert.deepEqual(pool.state.executed, ['CREATE TABLE fixture_one (id INT)', 'CREATE TABLE fixture_two (id INT)', 'CREATE TABLE fixture_three (id INT)']);
  assert.equal(pool.state.unlocks, 1);
  const count = pool.state.executed.length;
  const status = await phase1MigrationStatus(pool, options);
  assert.equal(status.drift.length, 1);
  assert.equal(status.pending.length, 1);
  await assert.rejects(runPhase1Migrations(pool, options), /drift/i);
  assert.equal(pool.state.executed.length, count);
});

test('fails when advisory lock cannot be acquired', async () => {
  const pool = database({ lock: 0 });
  await assert.rejects(runPhase1Migrations(pool, options), /lock/i);
  assert.equal(pool.state.tables.length, 0);
  assert.equal(pool.state.released, true);
});

test('names failed migration and warns that partial DDL needs inspection', async () => {
  const migrations = loadPhase1Migrations(fixture);

  const pool = database({ failStatement: true });
  await assert.rejects(runPhase1Migrations(pool, options), error => error.message.includes(migrations[0].name) && /inspect|rebuild/i.test(error.message));
  assert.equal(pool.state.unlocks, 1);
  assert.equal(pool.state.executed.length, 1);
  assert.equal(pool.state.rows[0].status, 'RUNNING');
  await assert.rejects(runPhase1Migrations(pool, options), /Incomplete migration/i);
});




test('preserves migration error when lock release also fails', async () => {
  const pool = database({ failStatement: true, failUnlock: true });
  await assert.rejects(runPhase1Migrations(pool, options), error =>
    /0001_test\.js/.test(error.message) && /DDL broke/.test(error.message) && /unlock broke/.test(error.message));
  assert.equal(pool.state.unlocks, 1);
  assert.equal(pool.state.released, true);
});

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadPhase1Migrations, phase1MigrationStatus, runPhase1Migrations } =
  require('../src/database/phase1/migration-runner');

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function migrationDirectory(statements = ['CREATE TABLE cb_sample (id BIGINT)']) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1-migration-'));
  directories.push(directory);
  fs.writeFileSync(path.join(directory, '0001_sample.js'), `module.exports = ${JSON.stringify({ statements })};\n`);
  return directory;
}

function respondToQuery(state, initial, sql, params) {
  if (/^SET time_zone/i.test(sql)) return [[], []];
  if (/GET_LOCK/i.test(sql)) return [[{ acquired: initial.lockResult ?? 1 }], []];
  if (/RELEASE_LOCK/i.test(sql)) {
    state.lockReleased++;
    if (initial.failUnlock) throw new Error('synthetic unlock failure');
    return [[{ released: initial.unlockResult ?? 1 }], []];
  }
  if (/information_schema\.tables/i.test(sql)) {
    return [[...state.tables].map((tableName) => ({ tableName })), []];
  }
  if (/^CREATE TABLE IF NOT EXISTS cb_schema_migrations/i.test(sql)) {
    state.tables.add('cb_schema_migrations');
    return [{}, []];
  }
  if (/^SELECT name, checksum, status FROM cb_schema_migrations/i.test(sql)) {
    return [[...state.applied].map(([name, row]) => ({ name, ...row })), []];
  }
  if (/^INSERT INTO cb_schema_migrations/i.test(sql)) {
    state.applied.set(params[0], { checksum: params[1], status: 'RUNNING' });
    return [{ affectedRows: 1 }, []];
  }
  if (/^UPDATE cb_schema_migrations/i.test(sql)) {
    state.applied.get(params[0]).status = 'APPLIED';
    return [{ affectedRows: 1 }, []];
  }
  if (initial.failStatement && sql.includes(initial.failStatement)) {
    throw new Error('synthetic DDL failure');
  }
  if (/^CREATE TABLE cb_/i.test(sql)) {
    state.tables.add(sql.match(/^CREATE TABLE (cb_\w+)/i)[1]);
    return [{}, []];
  }
  throw new Error(`unexpected SQL: ${sql}`);
}

function fakePool(initial = {}) {
  const state = {
    tables: new Set(initial.tables || []),
    applied: new Map(initial.applied || []),
    statements: [],
    released: 0,
    lockReleased: 0,
  };
  const connection = {
    async query(sql, params = []) {
      state.statements.push({ sql, params });
      return respondToQuery(state, initial, sql, params);
    },
    release() { state.released++; },
  };
  return { state, getConnection: async () => connection };
}

test('loads only ordered phase-one migration modules with stable checksums', () => {
  const directory = migrationDirectory();
  fs.writeFileSync(path.join(directory, 'README.md'), 'ignored');
  fs.writeFileSync(path.join(directory, '0002_second.js'), 'module.exports = { statements: ["CREATE TABLE cb_second (id BIGINT)"] };\n');
  const migrations = loadPhase1Migrations(directory);
  assert.deepEqual(migrations.map(({ name }) => name), ['0001_sample', '0002_second']);
  assert.match(migrations[0].checksum, /^[a-f0-9]{64}$/);
});

test('first run creates metadata and applies each migration once; repeat and status stay stable', async () => {
  const directory = migrationDirectory();
  const pool = fakePool();
  const first = await runPhase1Migrations(pool, { directory });
  assert.deepEqual(first.applied, ['0001_sample']);
  assert.deepEqual([...pool.state.tables].sort(), ['cb_sample', 'cb_schema_migrations']);
  const second = await runPhase1Migrations(pool, { directory });
  assert.deepEqual(second.applied, []);
  const status = await phase1MigrationStatus(pool, { directory });
  assert.equal(status.compatible, true);
  assert.deepEqual(status.applied, ['0001_sample']);
  assert.deepEqual(status.pending, []);
  assert.deepEqual(status.drift, []);
  assert.equal(pool.state.statements.filter(({ sql }) => sql === 'CREATE TABLE cb_sample (id BIGINT)').length, 1);
  assert.equal(pool.state.released, 3);
});

test('first run rejects an existing table before creating migration metadata', async () => {
  const directory = migrationDirectory();
  const pool = fakePool({ tables: ['cb_legacy_location'] });
  await assert.rejects(runPhase1Migrations(pool, { directory }), /nonempty|非空/i);
  assert.deepEqual([...pool.state.tables], ['cb_legacy_location']);
  assert.equal(pool.state.lockReleased, 1);
  assert.equal(pool.state.released, 1);
});

test('changed applied migration is reported as drift and never rerun', async () => {
  const directory = migrationDirectory();
  const pool = fakePool();
  await runPhase1Migrations(pool, { directory });
  fs.writeFileSync(path.join(directory, '0001_sample.js'), 'module.exports = { statements: ["CREATE TABLE cb_changed (id BIGINT)"] };\n');
  const status = await phase1MigrationStatus(pool, { directory });
  assert.equal(status.compatible, false);
  assert.deepEqual(status.drift, ['0001_sample']);
  await assert.rejects(runPhase1Migrations(pool, { directory }), /drift|漂移/i);
  assert.equal(pool.state.tables.has('cb_changed'), false);
});

test('lock failure prevents DDL and releases the connection', async () => {
  const directory = migrationDirectory();
  const pool = fakePool({ lockResult: 0 });
  await assert.rejects(runPhase1Migrations(pool, { directory }), /lock|锁/i);
  assert.equal(pool.state.tables.size, 0);
  assert.equal(pool.state.lockReleased, 0);
  assert.equal(pool.state.released, 1);
});

test('accepts a lock result returned as a driver string', async () => {
  const directory = migrationDirectory();
  const pool = fakePool({ lockResult: '1' });
  const result = await runPhase1Migrations(pool, { directory });
  assert.deepEqual(result.applied, ['0001_sample']);
});

test('mid-DDL failure names the migration and does not imply rollback', async () => {
  const directory = migrationDirectory([
    'CREATE TABLE cb_first (id BIGINT)',
    'CREATE TABLE cb_fail (id BIGINT)',
  ]);
  const pool = fakePool({ failStatement: 'cb_fail' });
  await assert.rejects(runPhase1Migrations(pool, { directory }),
    /0001_sample.*partial DDL.*Cause: synthetic DDL failure/i);
  assert.equal(pool.state.tables.has('cb_first'), true);
  assert.equal(pool.state.applied.get('0001_sample').status, 'RUNNING');
  assert.equal(pool.state.lockReleased, 1);
  assert.equal(pool.state.released, 1);
});

test('retry refuses a migration left incomplete by partial DDL', async () => {
  const directory = migrationDirectory([
    'CREATE TABLE cb_first (id BIGINT)',
    'CREATE TABLE cb_fail (id BIGINT)',
  ]);
  const pool = fakePool({ failStatement: 'cb_fail' });
  await assert.rejects(runPhase1Migrations(pool, { directory }), /partial DDL/i);
  const attemptsBeforeRetry = pool.state.statements.filter(({ sql }) => sql.includes('cb_first')).length;
  await assert.rejects(runPhase1Migrations(pool, { directory }), /incomplete|未完成/i);
  assert.equal(pool.state.statements.filter(({ sql }) => sql.includes('cb_first')).length, attemptsBeforeRetry);
});

test('unlock failure does not hide the failed migration', async () => {
  const directory = migrationDirectory(['CREATE TABLE cb_fail (id BIGINT)']);
  const pool = fakePool({ failStatement: 'cb_fail', failUnlock: true });
  await assert.rejects(runPhase1Migrations(pool, { directory }),
    /0001_sample.*partial DDL.*unlock failure/i);
  assert.equal(pool.state.released, 1);
});

test('a failed lock release result is not reported as migration success', async () => {
  const directory = migrationDirectory();
  const pool = fakePool({ unlockResult: 0 });
  await assert.rejects(runPhase1Migrations(pool, { directory }), /unlock failure/i);
  assert.equal(pool.state.released, 1);
});

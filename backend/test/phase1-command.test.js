const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const backend = path.resolve(__dirname, '..');
const scripts = require('../package.json').scripts;

// Run the package's actual entry point with only the external database replaced.
async function command(name, tables = [], broken = false) {
  assert.match(scripts[name], /^node scripts\/[\w-]+\.js$/);
  const filename = path.join(backend, scripts[name].slice(5));
  const realRequire = createRequire(filename);
  const queries = [];
  let closed = false;
  let released = false;
  const connection = {
    async query(sql) {
      queries.push(sql);
      if (broken) throw new Error('connection unavailable');
      if (/GET_LOCK/.test(sql)) return [[{ acquired: 1 }]];
      if (/information_schema\.tables/.test(sql)) return [tables.map(table_name => ({ table_name }))];
      if (/SET time_zone|RELEASE_LOCK/.test(sql)) return [[]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release() { released = true; }
  };
  const pool = { async getConnection() { return connection; } };
  let stdout = '';
  let stderr = '';
  const process = {
    exitCode: 0,
    stdout: { write(value) { stdout += value; } },
    stderr: { write(value) { stderr += value; } }
  };
  await vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    process,
    require(request) {
      if (request === '../src/config/database') return {
        getPool: () => pool,
        closeDatabase: async () => { closed = true; }
      };
      assert.notEqual(request, '../src/database/migration-runner', 'Legacy migration runner must never load');
      return realRequire(request);
    }
  }, { filename });
  return { stdout, stderr, exitCode: process.exitCode, closed, released, queries };
}

test('default status lists only the four phase-one migrations without writing DDL', async () => {
  const result = await command('migrate:status');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout).pending.map(item => item.name), [
    '0001_identity_profile.js', '0002_sessions_locations.js',
    '0003_feedback_governance.js', '0004_clearance_audit.js'
  ]);
  assert.ok(result.queries.every(sql => /^SELECT/.test(sql)));
  assert.ok(result.closed && result.released);
});

test('default migrate rejects legacy tables before any schema writes', async () => {
  const result = await command('migrate', ['cb_vendor_locations']);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Non-empty schema.*cb_vendor_locations/);
  assert.ok(result.queries.every(sql => !/CREATE|INSERT|UPDATE/.test(sql)));
  assert.ok(result.closed && result.released);
});

test('incompatible status exits 2 and database errors exit 1 with cleanup', async () => {
  const incompatible = await command('migrate:status', ['cb_vendor_locations']);
  assert.equal(incompatible.exitCode, 2);
  assert.equal(JSON.parse(incompatible.stdout).compatible, false);
  for (const name of ['migrate', 'migrate:status']) {
    const failure = await command(name, [], true);
    assert.equal(failure.exitCode, 1);
    assert.match(failure.stderr, /connection unavailable/);
    assert.ok(failure.closed && failure.released);
  }
});

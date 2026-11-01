const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { runPhase1Migrations, phase1MigrationStatus, loadPhase1Migrations } = require('../src/database/phase1/migration-runner');

// Deliberately no dotenv or application pool: only an explicitly disposable schema.
function readTestConfig(env) {
  const database = env.PHASE1_TEST_DATABASE;
  if (!database) return { reason: 'PHASE1_TEST_DATABASE is not configured' };
  assert.match(database, /^phase1_test_[a-zA-Z0-9_]+$/, 'Database must use the phase1_test_ prefix');
  assert.equal(env.PHASE1_TEST_ISOLATED, 'YES', 'PHASE1_TEST_ISOLATED=YES must confirm a disposable isolated database');
  assert.match(env.PHASE1_TEST_MYSQL_VERSION || '', /^8\.\d+\.\d+$/, 'PHASE1_TEST_MYSQL_VERSION must specify the exact target MySQL 8 version');
  assert.ok(env.PHASE1_TEST_USER, 'PHASE1_TEST_USER is required');
  const port = Number(env.PHASE1_TEST_PORT || 3306);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, 'Invalid test database port');
  return {
    version: env.PHASE1_TEST_MYSQL_VERSION,
    connection: {
      host: env.PHASE1_TEST_HOST || '127.0.0.1', port, database,
      user: env.PHASE1_TEST_USER, password: env.PHASE1_TEST_PASSWORD || '',
      supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false,
      timezone: 'Z', charset: 'utf8mb4', connectionLimit: 4, connectTimeout: 10000
    }
  };
}

async function verifyPhase1Schema(config, options = {}) {
  assert.ok(!config.reason, config.reason);
  const pool = require('mysql2/promise').createPool(config.connection);
  pool.on('connection', connection => connection.query("SET time_zone = '+00:00'"));
  const report = options.report || (evidence => console.log(JSON.stringify(evidence)));
  let stage = 'target version, UTC, strict mode and empty-schema preflight';
  // node:test subtests report failures without rejecting t.test(); abort dependent checks.
  const check = async (name, fn) => {
    stage = name;
    let failure;
    const run = async () => {
      try { await fn(); } catch (error) {
        // Database errors can embed SQL and connection details in node:test output.
        failure = error.code?.startsWith('ER_') || error.sql || error.syscall
          ? new Error(`Database verification failed at ${name} (${error.code || 'driver error'})`)
          : error;
        throw failure;
      }
    };
    if (options.check) await options.check(name, run);
    else await run();
    if (failure) throw failure;
    report({ check: name, outcome: 'PASS' });
  };
  let copy;
  try {
    const [[server]] = await pool.query('SELECT VERSION() AS version, DATABASE() AS schema_name, @@session.time_zone AS time_zone, @@session.sql_mode AS sql_mode');
    assert.ok(!/mariadb/i.test(server.version), 'Target must be MySQL, not MariaDB');
    assert.equal(server.version.split('-')[0], config.version, 'Server differs from the configured target version');
    assert.equal(server.schema_name, config.connection.database);
    assert.equal(server.time_zone, '+00:00');
    assert.match(server.sql_mode, /STRICT_(TRANS|ALL)_TABLES/);
    const [existing] = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()');
    assert.equal(existing.length, 0, 'Verification requires a newly created empty schema; recreate it manually before rerunning');
    report({ serverVersion: server.version, schema: server.schema_name, timeZone: server.time_zone });
    const migrations = loadPhase1Migrations();
    await check('empty migration, repeat and status', async () => {
      const before = await phase1MigrationStatus(pool);
      assert.equal(before.applied.length, 0);
      assert.equal(before.pending.length, migrations.length);
      const first = await runPhase1Migrations(pool);
      assert.equal(first.applied.length, migrations.length);
      assert.equal(first.pending.length, 0);
      const [records] = await pool.query('SELECT * FROM cb_phase1_schema_migrations ORDER BY name');
      const second = await runPhase1Migrations(pool);
      const [repeatRecords] = await pool.query('SELECT * FROM cb_phase1_schema_migrations ORDER BY name');
      assert.deepEqual(repeatRecords, records);
      assert.equal(second.compatible, true);
      const status = await phase1MigrationStatus(pool);
      assert.equal(status.compatible, true);
      assert.deepEqual(status.applied.map(row => row.name), migrations.map(row => row.name));
      report({ migrations: status.applied.map(row => row.name) });
    });
    await check('all tables, engines, collations, indexes and generated columns', async () => {
      const expected = migrations.flatMap(m => m.statements.map(sql => sql.match(/CREATE TABLE\s+(\w+)/i)?.[1]).filter(Boolean));
      const [tables] = await pool.query('SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation_name FROM information_schema.tables WHERE table_schema = DATABASE()');
      assert.deepEqual(tables.map(row => row.name).sort(), [...expected, 'cb_phase1_schema_migrations'].sort());
      for (const table of tables) {
        assert.equal(table.engine, 'InnoDB');
        assert.match(table.collation_name, /^utf8mb4_/);
      }
      const [foreignKeys] = await pool.query("SELECT CONSTRAINT_NAME FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND constraint_type = 'FOREIGN KEY'");
      assert.equal(foreignKeys.length, 0);
      const [indexes] = await pool.query('SELECT INDEX_NAME AS name, NON_UNIQUE AS non_unique FROM information_schema.statistics WHERE table_schema = DATABASE()');
      for (const name of ['uq_profile_pending', 'uq_session_unfinished', 'uq_location_unstopped']) {
        assert.ok(indexes.some(row => row.name === name && Number(row.non_unique) === 0), name);
      }
      const [generated] = await pool.query("SELECT COLUMN_NAME AS name, EXTRA AS extra FROM information_schema.columns WHERE table_schema = DATABASE() AND COLUMN_NAME IN ('pending_vendor_id','unfinished_vendor_id','unstopped_session_id')");
      assert.equal(generated.length, 3);
      generated.forEach(row => assert.match(row.extra, /STORED GENERATED/));
    });
    await check('checksum drift on disposable migration copy', async () => {
      copy = await fs.mkdtemp(path.join(os.tmpdir(), 'phase1-verify-'));
      const source = path.join(__dirname, '../src/database/phase1/migrations');
      for (const migration of migrations) await fs.copyFile(path.join(source, migration.name), path.join(copy, migration.name));
      await fs.appendFile(path.join(copy, migrations[0].name), '\n// disposable checksum drift probe\n');
      const status = await phase1MigrationStatus(pool, { directory: copy });
      assert.deepEqual(status.drift.map(row => row.name), [migrations[0].name]);
      await assert.rejects(runPhase1Migrations(pool, { directory: copy }), /checksum drift/);
      assert.equal((await phase1MigrationStatus(pool)).compatible, true);
    });
    const profile = version => [`INSERT INTO cb_vendor_profile_versions
      (vendor_id,version_no,vendor_name,category_code,regular_items_text,price_description,announcement,review_status,submitted_at_ms)
      VALUES (100,?,'测试😀','TEST','items','price','notice','PENDING',1000)`, [version]];
    const session = vendor => ['INSERT INTO cb_vendor_sessions (vendor_id,profile_version_id,started_at_ms,planned_end_at_ms) VALUES (?,1,1000,2000)', [vendor]];
    const location = (sessionId, version, lat = '31.1234567', lng = '121.7654321') => [
      `INSERT INTO cb_session_locations (session_id,vendor_id,version_no,lat,lng,location_name,located_at_ms,effective_at_ms)
       VALUES (?,100,?,?,?,'测试😀',1000,1000)`, [sessionId, version, lat, lng]
    ];
    async function race(first, second, index) {
      const connections = await Promise.all([pool.getConnection(), pool.getConnection()]);
      try {
        const results = await Promise.allSettled(connections.map((connection, i) => connection.execute(...[first, second][i])));
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        const rejected = results.find(result => result.status === 'rejected');
        assert.equal(rejected?.reason.code, 'ER_DUP_ENTRY');
        assert.ok(rejected.reason.message.includes(index), 'Conflict must use the generated unique key');
      } finally { connections.forEach(connection => connection.release()); }
    }
    await check('concurrent pending profiles and terminal history', async () => {
      await race(profile(1), profile(2), 'uq_profile_pending');
      await pool.query("UPDATE cb_vendor_profile_versions SET review_status='REJECTED', decided_at_ms=1100 WHERE vendor_id=100");
      await pool.execute(...profile(3));
      await pool.query("UPDATE cb_vendor_profile_versions SET review_status='APPROVED', decided_at_ms=1200 WHERE vendor_id=100 AND review_status='PENDING'");
      await pool.execute(...profile(4));
    });
    await check('concurrent unfinished sessions and ended history', async () => {
      await race(session(100), session(100), 'uq_session_unfinished');
      await pool.query("UPDATE cb_vendor_sessions SET ended_at_ms=1500,end_reason='MANUAL' WHERE vendor_id=100");
      await pool.execute(...session(100));
    });
    await check('concurrent unstopped locations and stopped history', async () => {
      await race(location(100, 1), location(100, 2), 'uq_location_unstopped');
      await pool.query("UPDATE cb_session_locations SET stopped_at_ms=1500,stop_reason='SUPERSEDED' WHERE session_id=100");
      await pool.execute(...location(100, 3));
    });
    await check('DECIMAL metadata, exact coordinates, enforced range and time CHECKs', async () => {
      const [columns] = await pool.query("SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='cb_session_locations' AND column_name IN ('lat','lng')");
      assert.equal(columns.find(row => row.name === 'lat').type, 'decimal(10,7)');
      assert.equal(columns.find(row => row.name === 'lng').type, 'decimal(11,7)');
      const [[point]] = await pool.query('SELECT lat,lng,location_name FROM cb_session_locations WHERE session_id=100 AND version_no=3');
      assert.equal(point.lat, '31.1234567');
      assert.equal(point.lng, '121.7654321');
      assert.equal(point.location_name, '测试😀');
      for (const args of [location(201, 1, '90.0000001'), location(202, 1, '0', '180.0000001'), location(203, 1, null, '1')]) {
        await assert.rejects(pool.execute(...args), error => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
      }
      await assert.rejects(pool.query('INSERT INTO cb_vendor_sessions (vendor_id,profile_version_id,started_at_ms,planned_end_at_ms) VALUES (300,1,1000,1000)'), error => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
      await pool.execute(...location(204, 1, '-90.0000000', '180.0000000'));
    });
    await check('BIGINT IDs beyond Number.MAX_SAFE_INTEGER and millisecond types', async () => {
      const id = '9007199254740993';
      const ms = '1793491200123';
      await pool.execute('INSERT INTO cb_accounts (id,wx_openid,created_at_ms,last_seen_at_ms) VALUES (?,?,?,?)', [id, 'phase1-verification', ms, ms]);
      const [[account]] = await pool.execute('SELECT id,created_at_ms FROM cb_accounts WHERE id=?', [id]);
      assert.equal(account.id, id);
      assert.equal(account.created_at_ms, ms);
      const [columns] = await pool.query("SELECT DATA_TYPE AS type FROM information_schema.columns WHERE table_schema=DATABASE() AND column_name LIKE '%!_at!_ms' ESCAPE '!'");
      assert.ok(columns.length > 0);
      columns.forEach(column => assert.equal(column.type, 'bigint'));
    });
    report({ outcome: 'PASS', note: 'Disposable schema retained for inspection; recreate it before another run.' });
  } catch (error) {
    report({ check: stage, outcome: 'FAIL', code: error.code || 'verification assertion' });
    if (error.code || error.sql || error.syscall) throw new Error(`Database verification failed at ${stage} (${error.code || 'driver error'})`);
    throw error;
  } finally {
    await pool.end();
    if (copy) await fs.rm(copy, { recursive: true, force: true });
  }
}

if (require.main === module) {
  (async () => {
    const config = readTestConfig(process.env);
    if (config.reason) {
      console.error(`BLOCKED: ${config.reason}; no live MySQL checks ran.`);
      process.exitCode = 2;
      return;
    }
    await verifyPhase1Schema(config);
  })().catch(error => {
    // Driver errors may contain SQL, connection details or credentials. Do not print them.
    console.error(`FAIL: phase-one verification stopped (${error.code || 'verification assertion'}). No database was dropped; inspect the isolated schema.`);
    process.exitCode = 1;
  });
}

module.exports = { readTestConfig, verifyPhase1Schema };

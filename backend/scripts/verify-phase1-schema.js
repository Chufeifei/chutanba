const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mysql = require('mysql2/promise');

const { checkColumnMetadata } = require('./phase1-verification-metadata');
const { checkUnicode } = require('./phase1-verification-unicode');
const { loadPhase1Migrations, phase1MigrationStatus, runPhase1Migrations } =
  require('../src/database/phase1/migration-runner');

function readConfig(env) {
  const database = env.PHASE1_TEST_DATABASE;
  if (!/^phase1_test_[A-Za-z0-9_]+$/.test(database || '')) {
    throw new Error('PHASE1_TEST_DATABASE must match phase1_test_*');
  }
  if (env.PHASE1_TEST_ISOLATED !== 'YES') throw new Error('PHASE1_TEST_ISOLATED must be YES');
  for (const key of ['PHASE1_TEST_MYSQL_VERSION', 'PHASE1_TEST_USER', 'PHASE1_TEST_PASSWORD']) {
    if (!env[key]) throw new Error(`${key} is required`);
  }
  return {
    database,
    version: env.PHASE1_TEST_MYSQL_VERSION,
    host: env.PHASE1_TEST_HOST || '127.0.0.1',
    port: Number(env.PHASE1_TEST_PORT || 3306),
    user: env.PHASE1_TEST_USER,
    password: env.PHASE1_TEST_PASSWORD,
  };
}

async function withUtc(pool, action) {
  const connection = await pool.getConnection();
  try {
    await connection.query("SET time_zone = '+00:00'");
    return await action(connection);
  } finally {
    connection.release();
  }
}

async function preflight(pool, config) {
  return withUtc(pool, async (connection) => {
    const [[server]] = await connection.query(
      'SELECT DATABASE() AS db, VERSION() AS version, @@session.time_zone AS timezone, @@session.sql_mode AS sqlMode, @@character_set_database AS charset',
    );
    assert.equal(server.db, config.database);
    assert.equal(server.version, config.version, 'target MySQL release differs');
    assert.equal(server.timezone, '+00:00');
    assert.match(server.sqlMode, /STRICT/);
    assert.equal(server.charset, 'utf8mb4');
    const [[count]] = await connection.query(
      'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ?', [config.database],
    );
    assert.equal(Number(count.total), 0, 'verification requires an empty isolated schema');
    return server.version;
  });
}

async function checkTableContract(pool, database) {
  await withUtc(pool, async (connection) => {
    const [tables] = await connection.query(
      'SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.tables WHERE table_schema = ?',
      [database],
    );
    const expected = loadPhase1Migrations().flatMap(({ statements }) => statements)
      .map((sql) => /^CREATE TABLE (cb_\w+)/.exec(sql)?.[1]).filter(Boolean);
    expected.push('cb_schema_migrations');
    assert.deepEqual(tables.map((row) => row.name).sort(), expected.sort());
    for (const table of tables) {
      assert.equal(table.engine, 'InnoDB', table.name);
      assert.match(table.collation, /^utf8mb4_/, table.name);
    }
    const [[keys]] = await connection.query(
      "SELECT COUNT(*) AS total FROM information_schema.referential_constraints WHERE constraint_schema = ?", [database],
    );
    assert.equal(Number(keys.total), 0, 'physical foreign keys are not in the W1 contract');
    await checkColumnMetadata(connection, database);
  });
}

async function oneWinner(pool, sql, first, second) {
  const attempts = await Promise.allSettled([first, second].map((params) => withUtc(pool, async (connection) => {
    await connection.query(sql, params);
  })));
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  const failure = attempts.find((attempt) => attempt.status === 'rejected');
  assert.equal(failure?.reason?.code, 'ER_DUP_ENTRY');
}

async function checkActiveUnique(pool) {
  const profile = `INSERT INTO cb_vendor_profile_version
    (vendor_id, version_no, vendor_name, category_code, regular_items_text,
     price_description, announcement, review_status, submitted_at_ms)
    VALUES (?, ?, '测试摊主', 'FOOD', '常卖内容', '价格说明', '公告', 'PENDING', 1000)`;
  await oneWinner(pool, profile, [101, 1], [101, 2]);
  await withUtc(pool, (connection) => connection.query(
    "UPDATE cb_vendor_profile_version SET review_status = 'APPROVED' WHERE vendor_id = 101 AND review_status = 'PENDING'",
  ));
  await withUtc(pool, (connection) => connection.query(profile, [101, 3]));

  const session = `INSERT INTO cb_vendor_session
    (vendor_id, profile_version_id, started_at_ms, planned_end_at_ms)
    VALUES (?, 1, 1000, 14401000)`;
  await oneWinner(pool, session, [101], [101]);
  await withUtc(pool, (connection) => connection.query(
    "UPDATE cb_vendor_session SET ended_at_ms = 2000, end_reason = 'MANUAL' WHERE vendor_id = 101",
  ));
  await withUtc(pool, (connection) => connection.query(session, [101]));

  const location = `INSERT INTO cb_session_location
    (session_id, vendor_id, version_no, lat, lng, location_name, located_at_ms, effective_at_ms)
    VALUES (900, 101, ?, 31.1234567, 121.1234567, '测试位置', 1000, 1000)`;
  await oneWinner(pool, location, [1], [2]);
  await withUtc(pool, (connection) => connection.query(
    "UPDATE cb_session_location SET stopped_at_ms = 2000, stop_reason = 'SUPERSEDED' WHERE session_id = 900 AND stopped_at_ms IS NULL",
  ));
  await withUtc(pool, (connection) => connection.query(location, [3]));
}

async function checkDecimalAndChecks(pool) {
  await withUtc(pool, async (connection) => {
    const [[value]] = await connection.query(
      'SELECT lat, lng FROM cb_session_location WHERE session_id = 900 AND version_no = 3',
    );
    assert.equal(value.lat, '31.1234567');
    assert.equal(value.lng, '121.1234567');
    await assert.rejects(connection.query(
      "INSERT INTO cb_session_location (session_id,vendor_id,version_no,lat,lng,location_name,located_at_ms,effective_at_ms) VALUES (901,101,1,91,121,'bad',1000,1000)",
    ), (error) => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
    await assert.rejects(connection.query(
      'INSERT INTO cb_vendor_session (vendor_id,profile_version_id,started_at_ms,planned_end_at_ms) VALUES (999,1,1000,1000)',
    ), (error) => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
    for (const [sessionId, lat, lng] of [[902, '90.0000000', '180.0000000'], [903, '-90.0000000', '-180.0000000']]) {
      await connection.query(
        "INSERT INTO cb_session_location (session_id,vendor_id,version_no,lat,lng,location_name,located_at_ms,effective_at_ms) VALUES (?,101,1,?,?,'boundary',1000,1000)",
        [sessionId, lat, lng],
      );
    }
    await assert.rejects(connection.query(
      "INSERT INTO cb_session_location (session_id,vendor_id,version_no,lat,lng,location_name,located_at_ms,effective_at_ms) VALUES (904,101,1,31,181,'bad',1000,1000)",
    ), (error) => error.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
    await assert.rejects(connection.query(
      "INSERT INTO cb_session_location (session_id,vendor_id,version_no,lat,lng,location_name,located_at_ms,effective_at_ms) VALUES (905,101,1,NULL,121,'bad',1000,1000)",
    ), (error) => error.code === 'ER_BAD_NULL_ERROR');
  });
}

async function checkLargeInteger(pool) {
  await withUtc(pool, async (connection) => {
    const large = '9007199254740993';
    await connection.query(
      'INSERT INTO cb_user_account (id,wx_openid,created_at_ms,updated_at_ms) VALUES (?,?,?,?)',
      [large, 'phase1-large-id', large, large],
    );
    const [[row]] = await connection.query(
      'SELECT id, created_at_ms AS createdAtMs FROM cb_user_account WHERE wx_openid = ?', ['phase1-large-id'],
    );
    assert.equal(row.id, large);
    assert.equal(row.createdAtMs, large);
  });
}

async function checkDrift(pool) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1-drift-'));
  try {
    const source = path.join(__dirname, '../src/database/phase1/migrations');
    fs.cpSync(source, temporary, { recursive: true });
    const first = path.join(temporary, '0001_identity_profile.js');
    fs.appendFileSync(first, '\n// checksum drift fixture\n');
    const status = await phase1MigrationStatus(pool, { directory: temporary });
    assert.deepEqual(status.drift, ['0001_identity_profile']);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function verifyPhase1Schema(config) {
  const pool = mysql.createPool({
    host: config.host, port: config.port, user: config.user, password: config.password,
    database: config.database, waitForConnections: true, connectionLimit: 4,
    supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false,
  });
  const checks = [];
  try {
    const version = await preflight(pool, config);
    checks.push('empty-schema');
    const first = await runPhase1Migrations(pool);
    // 迁移数量随只增迁移增长，不能写死为 W1 的 7 个，否则新增迁移会让验证器误报。
    assert.equal(first.applied.length, loadPhase1Migrations().length);
    const second = await runPhase1Migrations(pool);
    assert.deepEqual(second.applied, []);
    const status = await phase1MigrationStatus(pool);
    assert.equal(status.pending.length, 0);
    checks.push('repeat-migration');
    await checkDrift(pool);
    checks.push('checksum-drift');
    await checkTableContract(pool, config.database);
    checks.push('table-contract');
    await checkActiveUnique(pool);
    checks.push('active-profile-unique', 'active-session-unique', 'active-location-unique');
    await checkDecimalAndChecks(pool);
    checks.push('decimal-and-checks', 'coordinate-boundaries');
    await checkLargeInteger(pool);
    checks.push('large-integer', 'bigint-metadata');
    await withUtc(pool, checkUnicode);
    checks.push('unicode-roundtrip', 'binary-identity');
    return { database: config.database, version, migrations: first.applied, checks };
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  verifyPhase1Schema(readConfig(process.env))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(`BLOCKED/FAILED: ${error.message}`); process.exitCode = 1; });
}

module.exports = { readConfig, verifyPhase1Schema };

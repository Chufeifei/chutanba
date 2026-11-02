const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_DIRECTORY = path.join(__dirname, 'migrations');
const METADATA_TABLE = 'cb_schema_migrations';
const LOCK_NAME = 'cb_phase1_migrations';
const CREATE_METADATA = `CREATE TABLE IF NOT EXISTS cb_schema_migrations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  checksum CHAR(64) COLLATE utf8mb4_bin NOT NULL,
  status VARCHAR(16) NOT NULL,
  applied_at_ms BIGINT NOT NULL,
  state_version BIGINT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_schema_migration_name (name),
  CONSTRAINT ck_schema_migration_checksum CHECK (CHAR_LENGTH(checksum) = 64)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

function loadPhase1Migrations(directory = MIGRATION_DIRECTORY) {
  const files = fs.readdirSync(directory)
    .filter((file) => /^\d{4}_[a-z0-9_]+\.js$/.test(file))
    .sort();
  const numbers = new Set();
  return files.map((file) => {
    const number = file.slice(0, 4);
    if (numbers.has(number)) throw new Error(`Duplicate phase-one migration number: ${number}`);
    numbers.add(number);
    const source = path.join(directory, file);
    const definition = require(source);
    if (!Array.isArray(definition.statements) || definition.statements.length === 0 ||
        definition.statements.some((statement) => typeof statement !== 'string' || !statement.trim())) {
      throw new Error(`Invalid phase-one migration statements: ${file}`);
    }
    return {
      name: file.slice(0, -3),
      checksum: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),
      description: definition.description || '',
      statements: definition.statements,
    };
  });
}

async function inspect(connection, migrations) {
  const [tables] = await connection.query(
    'SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = DATABASE()',
  );
  const names = tables.map((row) => row.tableName);
  const metadataExists = names.includes(METADATA_TABLE);
  if (!metadataExists) {
    return {
      applied: [], pending: migrations.map((migration) => migration.name), drift: [],
      compatible: names.length === 0, reason: names.length ? 'nonempty schema without phase-one metadata' : null,
      metadataExists,
    };
  }
  const [rows] = await connection.query('SELECT name, checksum, status FROM cb_schema_migrations ORDER BY name');
  const expected = new Map(migrations.map((migration) => [migration.name, migration.checksum]));
  const applied = rows.filter((row) => row.status === 'APPLIED').map((row) => row.name);
  const incomplete = rows.filter((row) => row.status !== 'APPLIED').map((row) => row.name);
  const drift = rows.filter((row) => expected.get(row.name) !== row.checksum).map((row) => row.name);
  const pending = migrations.filter((migration) => !applied.includes(migration.name)).map((migration) => migration.name);
  const reason = incomplete.length ? `incomplete migration: ${incomplete.join(', ')}` : drift.length ? 'migration drift' : null;
  return { applied, pending, drift, incomplete, compatible: !reason, reason, metadataExists };
}

async function withConnection(pool, callback) {
  const connection = await pool.getConnection();
  try {
    await connection.query("SET time_zone = '+00:00'");
    return await callback(connection);
  } finally {
    connection.release();
  }
}

async function phase1MigrationStatus(pool, { directory = MIGRATION_DIRECTORY } = {}) {
  const migrations = loadPhase1Migrations(directory);
  return withConnection(pool, (connection) => inspect(connection, migrations));
}

async function applyPending(connection, migrations, appliedNames) {
  const applied = [];
  for (const migration of migrations) {
    if (appliedNames.includes(migration.name)) continue;
    try {
      await connection.query(
        "INSERT INTO cb_schema_migrations (name, checksum, status, applied_at_ms) VALUES (?, ?, 'RUNNING', 0)",
        [migration.name, migration.checksum],
      );
      for (const statement of migration.statements) await connection.query(statement);
      await connection.query(
        "UPDATE cb_schema_migrations SET status = 'APPLIED', applied_at_ms = CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS UNSIGNED) WHERE name = ?",
        [migration.name],
      );
      applied.push(migration.name);
    } catch (cause) {
      // 带上底层原因：CLI 只打印 message，若不拼接 cause，失败时无法直接看出是哪条 DDL 出错。
      throw new Error(
        `Migration ${migration.name} failed; partial DDL may remain. Inspect or rebuild the isolated schema before retry. Cause: ${cause.message}`,
        { cause },
      );
    }
  }
  return applied;
}

async function runPhase1Migrations(pool, { directory = MIGRATION_DIRECTORY } = {}) {
  const migrations = loadPhase1Migrations(directory);
  return withConnection(pool, async (connection) => {
    const [lockRows] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [LOCK_NAME]);
    if (Number(lockRows[0]?.acquired) !== 1) throw new Error('Could not acquire phase-one migration lock');
    let migrationError;
    try {
      const status = await inspect(connection, migrations);
      if (!status.compatible) throw new Error(`Phase-one migration target is incompatible: ${status.reason}`);
      if (!status.metadataExists) await connection.query(CREATE_METADATA);
      const applied = await applyPending(connection, migrations, status.applied);
      return { applied, skipped: status.applied };
    } catch (error) {
      migrationError = error;
      throw error;
    } finally {
      try {
        const [releasedRows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]);
        if (Number(releasedRows[0]?.released) !== 1) {
          throw new Error('phase-one migration unlock failure: lock was not released');
        }
      } catch (cleanupError) {
        if (!migrationError) throw cleanupError;
        migrationError.message += `; unlock failure: ${cleanupError.message}`;
        migrationError.cleanupError = cleanupError;
      }
    }
  });
}

module.exports = { loadPhase1Migrations, phase1MigrationStatus, runPhase1Migrations };

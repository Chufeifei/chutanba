const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getPool } = require('../config/database');

const MIGRATION_LOCK = 'chutanba_vnext_migrations';
const MIGRATION_DIR = path.join(__dirname, 'migrations');

function listMigrationFiles() {
  return fs.readdirSync(MIGRATION_DIR)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.js$/.test(name))
    .sort();
}

function checksumFile(filePath, extraPaths = []) {
  const normalizedContent = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const hash = crypto.createHash('sha256').update(normalizedContent(filePath));
  for (const extraPath of extraPaths) {
    const stableName = path.relative(path.dirname(filePath), extraPath).replace(/\\/g, '/');
    hash.update('\0').update(stableName).update('\0').update(normalizedContent(extraPath));
  }
  return hash.digest('hex');
}

function loadMigrations() {
  return listMigrationFiles().map((file) => {
    const filePath = path.join(MIGRATION_DIR, file);
    delete require.cache[require.resolve(filePath)];
    const migration = require(filePath);
    if (!migration || !Array.isArray(migration.statements) || migration.statements.length === 0) {
      throw new Error(`迁移 ${file} 必须导出非空 statements 数组`);
    }
    return {
      file,
      filePath,
      checksum: checksumFile(filePath, migration.checksumSources || []),
      description: migration.description || '',
      statements: migration.statements,
      apply: typeof migration.apply === 'function' ? migration.apply : null,
    };
  });
}

async function ensureMetadataTable(connection) {
  await connection.query(`CREATE TABLE IF NOT EXISTS cb_schema_migrations (
    migration_name VARCHAR(191) NOT NULL PRIMARY KEY,
    checksum_sha256 CHAR(64) NOT NULL,
    batch_no INT UNSIGNED NOT NULL,
    duration_ms INT UNSIGNED NOT NULL,
    applied_at_ms BIGINT UNSIGNED NOT NULL,
    CONSTRAINT chk_cb_schema_migrations_checksum CHECK (CHAR_LENGTH(checksum_sha256) = 64)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
}

async function readApplied(connection) {
  const [rows] = await connection.query(
    'SELECT migration_name, checksum_sha256, batch_no, applied_at_ms FROM cb_schema_migrations ORDER BY migration_name',
  );
  return new Map(rows.map((row) => [row.migration_name, row]));
}

async function metadataTableExists(connection) {
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS table_count
       FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'cb_schema_migrations'`,
  );
  return Number(rows[0]?.table_count) === 1;
}

function compareMigrations(migrations, applied) {
  const drift = [];
  const pending = [];
  for (const migration of migrations) {
    const row = applied.get(migration.file);
    if (!row) {
      pending.push(migration);
    } else if (row.checksum_sha256 !== migration.checksum) {
      drift.push({
        file: migration.file,
        expected: row.checksum_sha256,
        actual: migration.checksum,
      });
    }
  }
  const missingFiles = [...applied.keys()].filter((name) => !migrations.some((item) => item.file === name));
  return { drift, pending, missingFiles };
}

async function migrationStatus(pool = getPool()) {
  const connection = await pool.getConnection();
  try {
    const migrations = loadMigrations();
    const metadataPresent = await metadataTableExists(connection);
    const applied = metadataPresent ? await readApplied(connection) : new Map();
    const comparison = compareMigrations(migrations, applied);
    return {
      latest: migrations.at(-1)?.file || null,
      metadataTablePresent: metadataPresent,
      applied: [...applied.keys()],
      pending: comparison.pending.map((item) => item.file),
      drift: comparison.drift,
      missingFiles: comparison.missingFiles,
      compatible: metadataPresent
        && comparison.drift.length === 0
        && comparison.missingFiles.length === 0
        && comparison.pending.length === 0,
    };
  } finally {
    connection.release();
  }
}

async function runMigrations(pool = getPool()) {
  const connection = await pool.getConnection();
  let hasLock = false;
  try {
    const [lockRows] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [MIGRATION_LOCK]);
    hasLock = Number(lockRows[0]?.acquired) === 1;
    if (!hasLock) {
      throw new Error('无法取得数据库迁移锁，请确认没有其他发布进程正在执行迁移');
    }

    const migrations = loadMigrations();
    // The initial VNext DDL owns cb_schema_migrations. Creating it here first
    // makes the first statement of an empty-database migration fail.
    const metadataPresent = await metadataTableExists(connection);
    const applied = metadataPresent ? await readApplied(connection) : new Map();
    const { drift, missingFiles, pending } = compareMigrations(migrations, applied);
    if (drift.length || missingFiles.length) {
      throw new Error(`迁移历史漂移：${JSON.stringify({ drift, missingFiles })}`);
    }

    const batchNo = metadataPresent
      ? Number((await connection.query('SELECT COALESCE(MAX(batch_no), 0) + 1 AS next_batch FROM cb_schema_migrations'))[0][0].next_batch)
      : 1;
    const appliedNow = [];

    for (const migration of pending) {
      const startedAt = Date.now();
      if (migration.apply) {
        await migration.apply(connection);
      } else {
        for (const statement of migration.statements) {
          await connection.query(statement);
        }
      }
      const durationMs = Date.now() - startedAt;
      await connection.execute(
        `INSERT INTO cb_schema_migrations
          (migration_name, checksum_sha256, batch_no, duration_ms, applied_at_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [migration.file, migration.checksum, batchNo, durationMs, Date.now()],
      );
      appliedNow.push(migration.file);
    }

    return { batchNo, applied: appliedNow, latest: migrations.at(-1)?.file || null };
  } finally {
    if (hasLock) {
      try {
        await connection.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK]);
      } catch (error) {
        console.error('释放数据库迁移锁失败', error);
      }
    }
    connection.release();
  }
}

module.exports = {
  MIGRATION_DIR,
  listMigrationFiles,
  checksumFile,
  loadMigrations,
  compareMigrations,
  metadataTableExists,
  migrationStatus,
  runMigrations,
};

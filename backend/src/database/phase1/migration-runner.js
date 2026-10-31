const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const directory = path.join(__dirname, 'migrations');
const metadata = 'cb_phase1_schema_migrations';
const lockName = 'chutanba_phase1_migrations';

function loadPhase1Migrations(migrationDirectory = directory) {
  if (!fs.existsSync(migrationDirectory)) return [];
  return fs.readdirSync(migrationDirectory).filter(name => /^\d+_[\w-]+\.js$/.test(name)).sort().map(name => {
    const filename = path.join(migrationDirectory, name);
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    delete require.cache[require.resolve(filename)];
    const migration = require(filename);
    if (!Array.isArray(migration.statements) || !migration.statements.length || migration.statements.some(s => typeof s !== 'string' || !s.trim())) {
      throw new Error(`Invalid migration statements: ${name}`);
    }
    return { name, checksum, statements: migration.statements, description: migration.description };
  });
}

async function inspect(connection, migrations) {
  const [tables] = await connection.query('SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()');
  const names = tables.map(row => row.table_name || row.TABLE_NAME);
  const hasMetadata = names.includes(metadata);
  const [rows] = hasMetadata ? await connection.query('SELECT name, checksum, status FROM cb_phase1_schema_migrations ORDER BY name') : [[]];
  const byName = new Map(migrations.map(m => [m.name, m]));
  const drift = rows.filter(row => !byName.has(row.name) || byName.get(row.name).checksum !== row.checksum);
  const failed = rows.filter(row => row.status !== 'APPLIED');
  const applied = rows.filter(row => row.status === 'APPLIED');
  const recorded = new Set(rows.map(row => row.name));
  const pending = migrations.filter(m => !recorded.has(m.name));
  const incompatibleTables = !rows.length ? names.filter(name => name !== metadata) : [];
  return { applied, pending, drift, failed, compatible: !drift.length && !failed.length && !incompatibleTables.length, incompatibleTables, hasMetadata };
}

async function phase1MigrationStatus(pool, options = {}) {
  const connection = await pool.getConnection();
  try { return await inspect(connection, loadPhase1Migrations(options.directory)); }
  finally { connection.release(); }
}

async function runPhase1Migrations(pool, options = {}) {
  const connection = await pool.getConnection();
  let locked = false;
  let primaryError;
  try {
    const [lockRows] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
    if (Number(lockRows[0]?.acquired) !== 1) throw new Error('Unable to acquire phase-one migration lock');
    locked = true;
    await connection.query("SET time_zone = '+00:00'");
    const migrations = loadPhase1Migrations(options.directory);
    const status = await inspect(connection, migrations);
    if (status.incompatibleTables.length) throw new Error(`Non-empty schema is incompatible with phase-one migration: ${status.incompatibleTables.join(', ')}`);
    if (status.drift.length) throw new Error(`Migration checksum drift or missing migration: ${status.drift.map(row => row.name).join(', ')}`);
    if (status.failed.length) throw new Error(`Incomplete migration ${status.failed.map(row => row.name).join(', ')}; inspect partial DDL and rebuild the isolated schema before retrying`);
    if (!status.hasMetadata) await connection.query(`CREATE TABLE IF NOT EXISTS ${metadata} (name VARCHAR(255) NOT NULL PRIMARY KEY, checksum CHAR(64) NOT NULL, status VARCHAR(16) NOT NULL, applied_at TIMESTAMP NULL DEFAULT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    for (const migration of status.pending) {
      try {
        await connection.query(`INSERT INTO ${metadata} (name, checksum, status) VALUES (?, ?, 'RUNNING')`, [migration.name, migration.checksum]);
        for (const statement of migration.statements) await connection.query(statement);
        await connection.query(`UPDATE ${metadata} SET status = 'APPLIED', applied_at = CURRENT_TIMESTAMP WHERE name = ?`, [migration.name]);
      } catch (error) {
        throw new Error(`Migration ${migration.name} failed: ${error.message}. MySQL DDL may be partially applied; inspect and rebuild the isolated schema before retrying`, { cause: error });
      }
    }
    return await inspect(connection, migrations);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      if (locked) await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
      primaryError.message += `; lock release failed: ${cleanupError.message}`;
      primaryError.cleanupError = cleanupError;
    } finally { connection.release(); }
  }
}

module.exports = { runPhase1Migrations, phase1MigrationStatus, loadPhase1Migrations };



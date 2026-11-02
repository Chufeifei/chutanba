const { getPool, closeDatabase } = require('../src/db/pool');
const { phase1MigrationStatus } = require('../src/database/phase1/migration-runner');

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Show phase-one migration status for the configured DB_NAME (一期迁移状态).');
    return;
  }
  try {
    const status = await phase1MigrationStatus(getPool());
    console.log(JSON.stringify(status));
  } finally {
    await closeDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { main };

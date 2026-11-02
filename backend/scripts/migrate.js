const { getPool, closeDatabase } = require('../src/db/pool');
const { runPhase1Migrations } = require('../src/database/phase1/migration-runner');

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Run phase-one migrations on the configured DB_NAME (一期迁移).');
    return;
  }
  try {
    const result = await runPhase1Migrations(getPool());
    console.log(JSON.stringify(result));
  } finally {
    await closeDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { main };

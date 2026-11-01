const { phase1MigrationStatus } = require('../src/database/phase1/migration-runner');
const { getPool, closeDatabase } = require('../src/config/database');

Promise.resolve()
  .then(() => phase1MigrationStatus(getPool()))
  .then((status) => {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    if (!status.compatible) {
      process.exitCode = 2;
    }
  })
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(closeDatabase);

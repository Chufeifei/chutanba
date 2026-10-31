const { migrationStatus } = require('../src/database/migration-runner');
const { closeDatabase } = require('../src/config/database');

migrationStatus()
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


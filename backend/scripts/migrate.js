const { runMigrations } = require('../src/database/migration-runner');
const { closeDatabase } = require('../src/config/database');

runMigrations()
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(closeDatabase);


const { runPhase1Migrations } = require('../src/database/phase1/migration-runner');
const { getPool, closeDatabase } = require('../src/config/database');

Promise.resolve()
  .then(() => runPhase1Migrations(getPool()))
  .then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(closeDatabase);

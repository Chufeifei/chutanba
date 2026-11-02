const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('migration and status commands expose the dedicated phase-one entry points', () => {
  for (const command of ['migrate', 'migrate:status']) {
    const windows = process.platform === 'win32';
    const executable = windows ? 'cmd.exe' : 'npm';
    const args = windows
      ? ['/d', '/s', '/c', `npm --prefix backend run ${command} -- --help`]
      : ['--prefix', 'backend', 'run', command, '--', '--help'];
    const run = spawnSync(executable, args, {
      cwd: path.join(__dirname, '../..'),
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, `${command}: ${run.stderr}`);
    assert.match(run.stdout, /phase.one|一期/i);
  }
});

/**
 * advanced-location-filter 的构建期校验入口。
 *
 * 存在的原因：`tests/` 位于仓库根目录，直接用 glob 交给 node --test 在不同 shell 下
 * 展开行为不一致；本脚本显式枚举测试文件并逐个传入，保证 check 证据可复现。
 *
 * 同时执行静态检查：JS 语法、JSON 可解析、WXML 标签配平。
 * 单测只覆盖自己那一层，跨层一致性（代码↔DDL、代码↔契约）由专门的断言负责。
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const TEST_FILES = [
  'tests/location-schema.test.js',
  'tests/location-domain.test.js',
  'tests/location-service.test.js',
  'tests/location-region-service.test.js',
  'tests/location-routes.test.js',
  'tests/location-contracts.test.js',
];

function walk(dir, filter, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, found);
    else if (filter(full)) found.push(full);
  }
  return found;
}

function run(label, fn) {
  process.stdout.write(`\n== ${label} ==\n`);
  fn();
}

run('单元与契约测试', () => {
  execFileSync(process.execPath, ['--test', ...TEST_FILES], {
    cwd: ROOT,
    stdio: 'inherit',
  });
});

run('JS 语法检查', () => {
  const files = walk(path.join(ROOT, 'backend'), (f) => f.endsWith('.js'))
    .concat(walk(path.join(ROOT, 'miniprogram'), (f) => f.endsWith('.js')))
    .concat(TEST_FILES.map((f) => path.join(ROOT, f)));
  for (const file of files) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
  process.stdout.write(`${files.length} 个 JS 文件语法通过\n`);
});

run('JSON 可解析检查', () => {
  const files = walk(path.join(ROOT, 'backend'), (f) => f.endsWith('.json'))
    .concat(walk(path.join(ROOT, 'miniprogram'), (f) => f.endsWith('.json')));
  for (const file of files) {
    JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  process.stdout.write(`${files.length} 个 JSON 文件解析通过\n`);
});

run('WXML 标签配平检查', () => {
  const files = walk(path.join(ROOT, 'miniprogram'), (f) => f.endsWith('.wxml'));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const opened = (source.match(/<[a-zA-Z]/g) || []).length;
    const closed = (source.match(/<\//g) || []).length;
    const selfClosed = (source.match(/\/>/g) || []).length;
    if (opened !== closed + selfClosed) {
      throw new Error(`${path.relative(ROOT, file)} 标签不配平：开 ${opened} / 闭 ${closed} / 自闭合 ${selfClosed}`);
    }
  }
  process.stdout.write(`${files.length} 个 WXML 文件标签配平\n`);
});

process.stdout.write('\n构建期校验全部通过\n');
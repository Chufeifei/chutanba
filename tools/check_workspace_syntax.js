const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function files(extension) {
  const ignored = new Set(['.git', 'node_modules']);
  const found = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(`.${extension}`)) {
        found.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  }
  walk(root);
  return found.sort();
}

function checkJavaScript(file) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'pipe' });
}

function checkJson(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
  JSON.parse(text);
}

function checkWxml(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');
  const stack = [];
  const tagPattern = /<\s*(\/?)\s*([A-Za-z][\w-]*)(?:\s[^<>]*?)?\s*(\/?)>/g;
  for (const match of text.matchAll(tagPattern)) {
    const [, closing, name, selfClosing] = match;
    if (selfClosing) continue;
    if (!closing) {
      stack.push({ name, offset: match.index });
      continue;
    }
    const opening = stack.pop();
    if (!opening || opening.name !== name) {
      throw new Error(`${file}: closing </${name}> does not match ${opening ? `<${opening.name}>` : 'any opening tag'}`);
    }
  }
  if (stack.length) {
    const opening = stack.at(-1);
    throw new Error(`${file}: unclosed <${opening.name}> at offset ${opening.offset}`);
  }
}

const groups = [
  { extension: 'js', check: checkJavaScript, label: 'JavaScript node --check' },
  { extension: 'json', check: checkJson, label: 'JSON.parse' },
  { extension: 'wxml', check: checkWxml, label: 'WXML tag structure' },
];

const summary = {};
for (const group of groups) {
  const targets = files(group.extension);
  for (const file of targets) group.check(file);
  summary[group.label] = { passed: targets.length, total: targets.length };
}

console.log(JSON.stringify({ ok: true, summary }, null, 2));

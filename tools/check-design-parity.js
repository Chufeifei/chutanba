#!/usr/bin/env node
'use strict';

/*
 * 出摊吧 · 设计符合度静态自检 (Team C / C5 石渠｜自动化与基准)
 * 运行: node tools/check-design-parity.js [--json]
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Team C 路径差异声明
 * ─────────────────────────────────────────────────────────────────────────
 * A 组（逐屏人工比对）：逐个页面 index.wxml / index.wxss 按设计稿重排骨架、
 *   清理违规文案、替换旧色值，符合度依赖人工逐屏看，结论随人而变、不可复跑。
 * C 组（本工具所属路径）：组件驱动 + token 单一真相源 + 可复跑的静态规则，
 *   把「设计稿符合度」固化成 check-design-parity.js 工具链——规则数据全部取自
 *   tools/design-parity-manifest.json（forbidden / designTokens / routes /
 *   screenToRoute / scope / acceptance.checks），一次落盘、反复执行、机器可消费
 *   (--json)，产出 A 版没有的增量：一致、可回归、可量化的静态基线。
 *   本脚本不替代像素级视觉验收或真机渲染，只提供不被人工比对主观性影响的基线。
 *   C13（设计稿快照锚点）为后续追加，规则源为 manifest.acceptance.checks 的 C13 条目，
 *   用于避免云端画布改版后本地规则清单静默过期；下方编号对齐说明仍只描述原 C01~C12。
 *
 * 关于 manifest 与本任务 12 条检查编号的对齐（透明说明，便于终审复核）：
 *   本任务逐条给出的 C01~C12 实现细则为准（含「只扫 wxml / js 记 warning /
 *   非规格圆角列 warning / 有 var(--) 无 --x: 记 warning」等精确判定）。
 *   每条检查的 severity 与 rule 文本，取自 manifest.acceptance.checks 中语义
 *   对应的条目（按 description 关键字匹配，故与 manifest 的字母编号存在错位）；
 *   找不到对应条目的（C10 screenToRoute 覆盖、C11 app.wxss 色值齐全）按工具默认
 *   P1 并在输出中注明。所有判定数据（色值、字体、禁用串、路由、token、按钮
 *   尺寸、扫描范围）一律从 manifest 读取；manifest 缺失或字段不符即如实报错，
 *   绝不凭空造规则、绝不因结果难看而放宽规则。
 * ─────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_REL = 'tools/design-parity-manifest.json';
const APP_WXSS_REL = 'miniprogram/app.wxss';
// 设计稿结构快照：默认路径，优先取 manifest.meta.designRef.snapshot
const SNAPSHOT_DEFAULT_REL = 'tools/design-snapshot.json';
const DISCLAIMER = '本分数为静态扫描结果，不代表像素级视觉验收或真机渲染。';

const JSON_MODE = process.argv.slice(2).indexOf('--json') !== -1;

// ---------------------------------------------------------------------------
// 容错基础设施：任何单个文件读取失败只登记 warning，绝不抛出、不中断整体。
// ---------------------------------------------------------------------------
const fileWarnings = [];
const readCache = new Map();

function noteFileWarning(file, error) {
  fileWarnings.push({ file: file, error: String((error && error.message) || error) });
}

function safeRead(rel) {
  if (readCache.has(rel)) return readCache.get(rel);
  let text = null;
  try {
    text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (e) {
    noteFileWarning(rel, e);
    text = null;
  }
  readCache.set(rel, text);
  return text;
}

function safeJson(rel) {
  const text = safeRead(rel);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    noteFileWarning(rel, 'JSON 解析失败: ' + ((e && e.message) || e));
    return null;
  }
}

function getLines(rel) {
  const text = safeRead(rel);
  if (text === null) return null;
  return text.split(/\r?\n/);
}

function lineAt(text, index) {
  if (index < 0) return 1;
  return text.slice(0, index).split(/\r?\n/).length;
}

function escRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolvePath(obj, dotted) {
  let cur = obj;
  const parts = String(dotted).split('.');
  for (let i = 0; i < parts.length; i++) {
    if (cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, parts[i])) {
      cur = cur[parts[i]];
    } else {
      return undefined;
    }
  }
  return cur;
}

// ---------------------------------------------------------------------------
// 简易 glob：支持 **（跨目录）、*（单段内任意字符）、?。
// 路径统一为相对项目根的 POSIX 字符串（manifest 口径）。
// ---------------------------------------------------------------------------
function globToRegExp(glob) {
  const g = String(glob).split(path.sep).join('/');
  let re = '^';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          re += '(?:.*/)?';   // **/ 匹配零级或多级目录
          i += 2;
        } else {
          re += '.*';         // 末尾 ** 匹配任意剩余内容
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += escRe(c);
    }
  }
  return new RegExp(re + '$');
}

function walk(dirRel, out) {
  const abs = path.join(ROOT, dirRel);
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch (e) {
    noteFileWarning(dirRel + '/', e);
    return;
  }
  for (let i = 0; i < entries.length; i++) {
    const ent = entries[i];
    const rel = dirRel ? dirRel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) {
      walk(rel, out);
    } else if (ent.isFile()) {
      out.push(rel);
    }
  }
}

function rootsFromIncludes(includes) {
  const roots = [];
  for (const g of includes) {
    const first = String(g).split('/')[0];
    if (first && !/[*?]/.test(first) && roots.indexOf(first) === -1) roots.push(first);
  }
  return roots;
}

function collectScanned(manifest) {
  const includes = manifest.scope.scanInclude;
  const excludes = manifest.scope.scanExclude;
  const all = [];
  for (const r of rootsFromIncludes(includes)) walk(r, all);
  const incRe = includes.map(globToRegExp);
  const excRe = excludes.map(globToRegExp);
  return all.filter(function (f) {
    return incRe.some(function (re) { return re.test(f); }) &&
           !excRe.some(function (re) { return re.test(f); });
  }).sort();
}

function groupByExt(files) {
  const g = { wxml: [], wxss: [], js: [], json: [] };
  for (const f of files) {
    const m = /\.(wxml|wxss|js|json)$/.exec(f);
    if (m && g[m[1]]) g[m[1]].push(f);
  }
  return g;
}

// 在给定文件集合中查找若干字符串的出现（大小写不敏感，便于抓到小写色值变体）。
// 返回 [{file, line, term, snippet}]；逐行读取失败由 getLines 容错跳过。
function findOccurrences(files, terms) {
  const out = [];
  const list = (terms || []).filter(function (t) { return typeof t === 'string' && t.length > 0; });
  for (const f of files) {
    const lines = getLines(f);
    if (lines === null) continue;
    for (const term of list) {
      let re;
      try { re = new RegExp(escRe(term), 'gi'); } catch (e) { continue; }
      for (let ln = 0; ln < lines.length; ln++) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(lines[ln])) !== null) {
          out.push({
            file: f,
            line: ln + 1,
            term: term,
            snippet: lines[ln].trim().slice(0, 80)
          });
          if (m[0].length === 0) re.lastIndex++;
        }
      }
    }
  }
  return out;
}

function occEvidence(occ, tag) {
  return occ.file + ':' + occ.line + ' | ' + (tag ? tag + ' ' : '') + occ.term;
}

function makeResult(def, severity, rule, ruleRefs, status, hits, evidence, notes) {
  return {
    id: def.id,
    title: def.title,
    severity: severity,
    basis: def.basis,
    rule: rule,
    ruleRefs: ruleRefs,
    status: status,
    hits: hits,
    evidence: (evidence || []).slice(0, 5),
    notes: notes || []
  };
}

// 从 manifest.acceptance.checks 按 description 关键字找语义对应条目，取其
// severity / rule，实现「逐条读 rule 执行」；rule 里引用到的 manifest 字段路径
// 一并抽取并校验可解析，作为「按 manifest 字段设计检查项」的可核对证据。
function pickManifestCheck(checks, keyword) {
  for (const c of checks) {
    if (c && typeof c.description === 'string' && c.description.indexOf(keyword) !== -1) return c;
  }
  return null;
}

function ruleRefsOf(ruleText, manifest) {
  if (!ruleText) return [];
  const found = [];
  const re = /[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+/g;
  let m;
  while ((m = re.exec(ruleText)) !== null) {
    const p = m[0];
    if (resolvePath(manifest, p) !== undefined && found.indexOf(p) === -1) found.push(p);
  }
  return found;
}

// ---------------------------------------------------------------------------
// manifest 完整性校验：缺失或字段不符 -> 如实报错，不编造任何规则/结果。
// ---------------------------------------------------------------------------
function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['manifest 顶层不是对象'];
  const req = [
    ['meta', 'object'], ['designTokens', 'object'],
    ['designTokens.colors', 'object'], ['designTokens.radius', 'object'],
    ['designTokens.buttonSizes', 'object'], ['designTokens.fontSizes', 'object'],
    ['forbidden', 'object'], ['forbidden.legacyColors', 'array'],
    ['forbidden.fonts', 'array'], ['forbidden.ruleExplanations', 'array'],
    ['forbidden.phaseOneDisabled', 'array'], ['forbidden.devNotices', 'array'],
    ['scope', 'object'], ['scope.scanInclude', 'array'], ['scope.scanExclude', 'array'],
    ['routes', 'object'], ['routes.total', 'number'],
    ['routes.mainPackage', 'array'], ['routes.subPackages', 'array'],
    ['screenToRoute', 'object'], ['acceptance', 'object'], ['acceptance.checks', 'array']
  ];
  for (const pair of req) {
    const p = pair[0], t = pair[1];
    const v = resolvePath(m, p);
    if (v === undefined) { errors.push('缺少字段 ' + p); continue; }
    if (t === 'array') {
      if (!Array.isArray(v)) errors.push('字段 ' + p + ' 应为数组');
    } else if (typeof v !== t) {
      errors.push('字段 ' + p + ' 应为 ' + t + '（实测 ' + typeof v + '）');
    }
  }
  const checks = resolvePath(m, 'acceptance.checks');
  if (Array.isArray(checks) && checks.length < 8) {
    errors.push('acceptance.checks 少于 8 条（实测 ' + checks.length + '），无法对应至少 8 条检查');
  }
  const forbiddenArrays = ['legacyColors', 'fonts', 'ruleExplanations', 'phaseOneDisabled', 'devNotices'];
  for (const k of forbiddenArrays) {
    const a = resolvePath(m, 'forbidden.' + k);
    if (Array.isArray(a) && a.length === 0) errors.push('forbidden.' + k + ' 为空数组，规则不可用');
  }
  const inc = resolvePath(m, 'scope.scanInclude');
  if (Array.isArray(inc) && inc.length === 0) errors.push('scope.scanInclude 为空数组，无法确定扫描范围');
  const total = resolvePath(m, 'routes.total');
  if (typeof total === 'number' && total <= 0) errors.push('routes.total 非正数，规则不可用');
  return errors;
}

// ---------------------------------------------------------------------------
// 13 条检查定义。severity 优先取 manifest.acceptance.checks 语义对应条目，
// 缺失时取工具默认并注明。判定数据一律来自 manifest。
// C13 为设计稿快照锚点：把云端画布的结构基线（tools/design-snapshot.json）
// 与 manifest.meta.designRef 的版本声明对齐，避免画布改版后规则清单静默过期。
// ---------------------------------------------------------------------------
const CHECK_DEFS = [
  { id: 'C01', title: '参考稿旧色值零残留', kw: '旧色值', basis: 'forbidden.legacyColors', defaultSev: 'P0' },
  { id: 'C02', title: '旧字体 Sarasa 零残留', kw: '禁用字体', basis: 'forbidden.fonts', defaultSev: 'P0' },
  { id: 'C03', title: '业务规则解释禁用串零上屏', kw: '业务规则解释', basis: 'forbidden.ruleExplanations', defaultSev: 'P0' },
  { id: 'C04', title: '一期禁用能力词零上屏', kw: '一期禁用能力词', basis: 'forbidden.phaseOneDisabled', defaultSev: 'P0' },
  { id: 'C05', title: '开发说明串零残留', kw: '开发说明串', basis: 'forbidden.devNotices', defaultSev: 'P2' },
  { id: 'C06', title: '圆角规格', kw: '圆角规格', basis: 'designTokens.radius', defaultSev: 'P1' },
  { id: 'C07', title: '组件根节点变量声明', kw: '组件根节点变量', basis: 'miniprogram/components/*/index.wxss', defaultSev: 'P1' },
  { id: 'C08', title: '路由数一致', kw: '路由数', basis: 'routes.total / routes.source', defaultSev: 'P0' },
  { id: 'C09', title: '注册组件目录存在', kw: '注册组件目录', basis: 'app.json + 各 index.json 的 usingComponents', defaultSev: 'P1' },
  { id: 'C10', title: 'screenToRoute 覆盖 01~23', kw: 'screenToRoute 覆盖', basis: 'screenToRoute', defaultSev: 'P1' },
  { id: 'C11', title: 'app.wxss 变量区色值齐全', kw: '色值齐全', basis: 'designTokens.colors', defaultSev: 'P1' },
  { id: 'C12', title: '按钮规格', kw: '按钮规格', basis: 'designTokens.buttonSizes', defaultSev: 'P1' },
  { id: 'C13', title: '设计稿快照锚点一致', kw: '设计稿快照', basis: 'meta.designRef + tools/design-snapshot.json', defaultSev: 'P1' }
];

function runChecks(manifest, scanned, byExt) {
  const results = [];
  const checks = manifest.acceptance.checks;
  const forbidden = manifest.forbidden;
  const tokens = manifest.designTokens;
  const routes = manifest.routes;
  const manifestText = safeRead(MANIFEST_REL) || '';
  const s2rLine = lineAt(manifestText, manifestText.indexOf('"screenToRoute"'));

  function ctx(def) {
    const mc = pickManifestCheck(checks, def.kw);
    const severity = (mc && typeof mc.severity === 'string' && mc.severity) ? mc.severity : def.defaultSev;
    const rule = (mc && mc.rule) ? mc.rule :
      ('manifest.acceptance.checks 无语义对应条目；依据 ' + def.basis + ' + C5 任务细则执行');
    const refs = ruleRefsOf(mc && mc.rule, manifest);
    const notes = [];
    if (!mc) {
      notes.push('manifest.acceptance.checks 无语义对应条目，severity 取工具默认 ' + def.defaultSev + '；仅按 C5 任务细则与 manifest 字段执行');
    }
    return { mc: mc, severity: severity, rule: rule, refs: refs, notes: notes };
  }

  // C01 参考稿旧色值零残留（全扫描范围）
  {
    const def = CHECK_DEFS[0], c = ctx(def);
    const occ = findOccurrences(scanned, forbidden.legacyColors);
    c.notes.push('扫描范围 = scope.scanInclude ∩ ~scope.scanExclude 的全部文件（wxml/wxss/js/json）');
    results.push(makeResult(def, c.severity, c.rule, c.refs,
      occ.length ? 'FAIL' : 'PASS', occ.length,
      occ.slice(0, 5).map(function (o) { return occEvidence(o); }), c.notes));
  }

  // C02 旧字体零残留（全扫描范围）
  {
    const def = CHECK_DEFS[1], c = ctx(def);
    const occ = findOccurrences(scanned, forbidden.fonts);
    results.push(makeResult(def, c.severity, c.rule, c.refs,
      occ.length ? 'FAIL' : 'PASS', occ.length,
      occ.slice(0, 5).map(function (o) { return occEvidence(o); }), c.notes));
  }

  // C03 业务规则解释禁用串零上屏：只扫 *.wxml 判 FAIL；*.js（含 services/）同串记 warning 不算 fail
  {
    const def = CHECK_DEFS[2], c = ctx(def);
    const wxmlOcc = findOccurrences(byExt.wxml, forbidden.ruleExplanations);
    const jsOcc = findOccurrences(byExt.js, forbidden.ruleExplanations);
    const ev = [];
    for (const o of wxmlOcc.slice(0, 5)) ev.push(occEvidence(o, '[wxml-FAIL]'));
    for (const o of jsOcc.slice(0, Math.max(0, 5 - ev.length))) ev.push(occEvidence(o, '[js-WARN]'));
    const status = wxmlOcc.length ? 'FAIL' : (jsOcc.length ? 'WARN' : 'PASS');
    c.notes.push('按 C03 细则：仅 *.wxml 命中判 FAIL；*.js（含 services/，该目录未被 scanExclude 排除）命中记 warning 不计 fail');
    if (jsOcc.length) c.notes.push('js 侧命中 ' + jsOcc.length + ' 处，仅作 warning');
    results.push(makeResult(def, c.severity, c.rule, c.refs,
      status, wxmlOcc.length + jsOcc.length, ev, c.notes));
  }

  // C04 一期禁用能力词零上屏（全扫描范围）
  {
    const def = CHECK_DEFS[3], c = ctx(def);
    const occ = findOccurrences(scanned, forbidden.phaseOneDisabled);
    c.notes.push('按 manifest rule「扫描范围内不得出现」严格判定，注释行命中同样计入；是否属「上屏」由终审人工裁定');
    results.push(makeResult(def, c.severity, c.rule, c.refs,
      occ.length ? 'FAIL' : 'PASS', occ.length,
      occ.slice(0, 5).map(function (o) { return occEvidence(o); }), c.notes));
  }

  // C05 开发说明串零残留（wxml + js 都算）
  {
    const def = CHECK_DEFS[4], c = ctx(def);
    const files = byExt.wxml.concat(byExt.js);
    const occ = findOccurrences(files, forbidden.devNotices);
    c.notes.push('按 C05 细则：wxml 与 js 命中均计入');
    results.push(makeResult(def, c.severity, c.rule, c.refs,
      occ.length ? 'FAIL' : 'PASS', occ.length,
      occ.slice(0, 5).map(function (o) { return occEvidence(o); }), c.notes));
  }

  // C06 圆角规格：扫 *.wxss 的 border-radius，非规格值列 warning，不直接 fail
  {
    const def = CHECK_DEFS[5], c = ctx(def);
    const specs = Object.keys(tokens.radius).map(function (k) { return String(tokens.radius[k]).toLowerCase(); });
    const occ = [];
    for (const f of byExt.wxss) {
      const lines = getLines(f);
      if (lines === null) continue;
      for (let ln = 0; ln < lines.length; ln++) {
        const declRe = /border-radius\s*:\s*([^;]+);/g;
        let dm;
        while ((dm = declRe.exec(lines[ln])) !== null) {
          const value = dm[1];
          if (/var\(/i.test(value)) continue; // 走 token 的声明视为合规
          const valRe = /\d+(?:\.\d+)?(?:rpx|px|em|rem|vw|vh|%)/gi;
          let vm;
          while ((vm = valRe.exec(value)) !== null) {
            if (specs.indexOf(vm[0].toLowerCase()) === -1) {
              occ.push({ file: f, line: ln + 1, term: 'border-radius 非规格值 ' + vm[0], snippet: lines[ln].trim().slice(0, 80) });
            }
          }
        }
      }
    }
    c.notes.push('规格值集合(来自 designTokens.radius) = [' + specs.join(', ') + ']');
    c.notes.push('使用 var(--token) 的 border-radius 视为合规；纯 0 重置值不计入；非规格值列 warning，不直接 fail');
    results.push(makeResult(def, c.severity, c.rule, c.refs,
      occ.length ? 'WARN' : 'PASS', occ.length,
      occ.slice(0, 5).map(function (o) { return occEvidence(o); }), c.notes));
  }

  // C07 组件根节点变量声明：components/*/index.wxss 有 var(--) 但文件内无 --x: 声明记 warning
  {
    const def = CHECK_DEFS[6], c = ctx(def);
    const compRe = /^miniprogram\/components\/[^/]+\/index\.wxss$/;
    const compFiles = scanned.filter(function (f) { return compRe.test(f); });
    const declRe = /--[A-Za-z0-9_-]+\s*:/;
    const occ = [];
    for (const f of compFiles) {
      const text = safeRead(f);
      if (text === null) continue;
      if (/var\(--/.test(text) && !declRe.test(text)) {
        occ.push({ file: f, line: 1, term: '使用了 var(--) 但文件内无 --x: 变量声明' });
      }
    }
    c.notes.push('命中条件：文件含 var(--) 且不含形如 --x: 的变量声明；仅记 warning');
    const hasCDesign = fs.existsSync(path.join(ROOT, 'miniprogram/components/c-design'));
    if (!hasCDesign) {
      c.notes.push('manifest 对应 rule 指向 miniprogram/components/c-design/**（当前该目录不存在）；本检查按 C5 任务细则覆盖通用组件目录');
    }
    results.push(makeResult(def, c.severity, c.rule, c.refs,
      occ.length ? 'WARN' : 'PASS', occ.length,
      occ.slice(0, 5).map(function (o) { return occEvidence(o); }), c.notes));
  }

  // C08 路由数 = routes.total（读 routes.source 指向的 app.json，主包 pages + subPackages pages，并逐条比对）
  {
    const def = CHECK_DEFS[7], c = ctx(def);
    const appRel = routes.source || 'miniprogram/app.json';
    const app = safeJson(appRel);
    let occ = [], status;
    if (app === null) {
      c.notes.push('无法读取 ' + appRel + '，按容错仅记 warning，本检查判 WARN');
      status = 'WARN';
    } else {
      const main = Array.isArray(app.pages) ? app.pages : [];
      const subs = [];
      const sps = Array.isArray(app.subPackages) ? app.subPackages : [];
      for (const sp of sps) {
        const root = sp.root || '';
        const ps = Array.isArray(sp.pages) ? sp.pages : [];
        for (const p of ps) subs.push(root ? root + '/' + p : p);
      }
      const total = main.length + subs.length;
      if (total !== routes.total) occ.push({ file: appRel, line: 2, term: '路由总数 ' + total + ' ≠ routes.total ' + routes.total });
      const expMain = routes.mainPackage || [];
      for (let i = 0; i < Math.max(main.length, expMain.length); i++) {
        if (main[i] !== expMain[i]) occ.push({ file: appRel, line: 2, term: 'mainPackage[' + i + '] ' + main[i] + ' ≠ ' + expMain[i] });
      }
      const expSub = routes.subPackages || [];
      for (let i = 0; i < Math.max(subs.length, expSub.length); i++) {
        if (subs[i] !== expSub[i]) occ.push({ file: appRel, line: 18, term: 'subPackages[' + i + '] ' + subs[i] + ' ≠ ' + expSub[i] });
      }
      c.notes.push('subPackages.pages 按 root/pages 拼接后与 routes.subPackages 逐条比对；计数与逐条均须一致');
      status = occ.length ? 'FAIL' : 'PASS';
    }
    results.push(makeResult(def, c.severity, c.rule, c.refs,
      status, occ.length,
      occ.slice(0, 5).map(function (o) { return o.file + ':' + o.line + ' | ' + o.term; }), c.notes));
  }

  // C09 注册组件目录存在（app.json 全局 + 各 index.json 的 usingComponents，解析路径后检查目录存在）
  {
    const def = CHECK_DEFS[8], c = ctx(def);
    const occ = [];
    for (const jf of byExt.json) {
      const obj = safeJson(jf);
      if (!obj || !obj.usingComponents || typeof obj.usingComponents !== 'object') continue;
      const text = safeRead(jf) || '';
      for (const name of Object.keys(obj.usingComponents)) {
        const cp = obj.usingComponents[name];
        if (typeof cp !== 'string') continue;
        let base;
        if (cp.charAt(0) === '/') {
          base = 'miniprogram' + cp; // 绝对路径按 miniprogram 根解释
        } else {
          base = path.posix.normalize(path.posix.join(path.posix.dirname(jf), cp));
        }
        const dir = path.posix.dirname(base);
        const line = lineAt(text, text.indexOf(cp));
        let dirOk = false;
        try { dirOk = fs.existsSync(path.join(ROOT, dir)); } catch (e) { noteFileWarning(dir, e); }
        if (!dirOk) occ.push({ file: jf, line: line, term: '注册组件目录不存在: ' + name + ' -> ' + dir });
      }
    }
    c.notes.push('绝对路径(/...)按 miniprogram 根、相对路径按 json 所在目录 resolve；检查解析出的组件目录是否存在');
    results.push(makeResult(def, c.severity, c.rule, c.refs,
      occ.length ? 'FAIL' : 'PASS', occ.length,
      occ.slice(0, 5).map(function (o) { return o.file + ':' + o.line + ' | ' + o.term; }), c.notes));
  }

  // C10 screenToRoute 覆盖 01~23（读 manifest 自查）
  {
    const def = CHECK_DEFS[9], c = ctx(def);
    const s2r = manifest.screenToRoute;
    const occ = [];
    for (let i = 1; i <= 23; i++) {
      const k = ('0' + i).slice(-2);
      if (!s2r || !Object.prototype.hasOwnProperty.call(s2r, k)) {
        occ.push({ file: MANIFEST_REL, line: s2rLine, term: 'screenToRoute 缺少键 ' + k });
      } else {
        const e = s2r[k];
        if (!e || !e.route) occ.push({ file: MANIFEST_REL, line: s2rLine, term: 'screenToRoute.' + k + ' 缺 route' });
        if (!e || !e.stateField) occ.push({ file: MANIFEST_REL, line: s2rLine, term: 'screenToRoute.' + k + ' 缺 stateField' });
      }
    }
    c.notes.push('读 manifest.screenToRoute 自查 01~23 键齐全且各含 route/stateField');
    results.push(makeResult(def, c.severity, c.rule, c.refs,
      occ.length ? 'FAIL' : 'PASS', occ.length,
      occ.slice(0, 5).map(function (o) { return o.file + ':' + o.line + ' | ' + o.term; }), c.notes));
  }

  // C11 设计稿色值在 app.wxss 变量区齐全（对照 designTokens.colors）
  {
    const def = CHECK_DEFS[10], c = ctx(def);
    const appWxss = safeRead(APP_WXSS_REL);
    const targetColors = [];
    Object.keys(tokens.colors).forEach(function (k) {
      const v = String(tokens.colors[k]).toUpperCase();
      if (targetColors.indexOf(v) === -1) targetColors.push(v);
    });
    let occ = [], status;
    if (appWxss === null) {
      c.notes.push('无法读取 ' + APP_WXSS_REL + '，按容错仅记 warning，本检查判 WARN');
      status = 'WARN';
    } else {
      const declared = {};
      const re = /--[A-Za-z0-9_-]+\s*:\s*(#[0-9A-Fa-f]{3,8})/g;
      let m;
      while ((m = re.exec(appWxss)) !== null) declared[m[1].toUpperCase()] = true;
      const anchor = lineAt(appWxss, appWxss.indexOf('--color-'));
      for (const col of targetColors) {
        if (!declared[col]) occ.push({ file: APP_WXSS_REL, line: anchor, term: 'app.wxss 变量区缺少色值 ' + col });
      }
      c.notes.push('提取 app.wxss 中形如 --x: #HEX 的变量声明值，逐一比对 designTokens.colors（' + targetColors.length + ' 项，大小写不敏感）');
      status = occ.length ? 'FAIL' : 'PASS';
    }
    results.push(makeResult(def, c.severity, c.rule, c.refs,
      status, occ.length,
      occ.slice(0, 5).map(function (o) { return o.file + ':' + o.line + ' | ' + o.term; }), c.notes));
  }

  // C12 按钮规格：.btn-primary / .btn-secondary 的 width/height 等于 designTokens.buttonSizes
  {
    const def = CHECK_DEFS[11], c = ctx(def);
    const targets = [
      { cls: 'btn-primary', spec: tokens.buttonSizes.primary },
      { cls: 'btn-secondary', spec: tokens.buttonSizes.secondary }
    ];
    const wxssTexts = [];
    for (const f of byExt.wxss) {
      const t = safeRead(f);
      if (t !== null) wxssTexts.push({ file: f, text: t });
    }
    const occ = [];
    for (const tg of targets) {
      const re = new RegExp('\\.' + tg.cls + '\\s*\\{([^}]*)\\}', 'g');
      let found = false;
      for (const w of wxssTexts) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(w.text)) !== null) {
          found = true;
          const body = m[1];
          const wm = /width\s*:\s*([^;]+);/.exec(body);
          const hm = /height\s*:\s*([^;]+);/.exec(body);
          const wv = wm ? wm[1].trim() : '(缺失)';
          const hv = hm ? hm[1].trim() : '(缺失)';
          const line = lineAt(w.text, m.index);
          if (wv !== String(tg.spec.width)) occ.push({ file: w.file, line: line, term: tg.cls + ' width=' + wv + ' ≠ ' + tg.spec.width });
          if (hv !== String(tg.spec.height)) occ.push({ file: w.file, line: line, term: tg.cls + ' height=' + hv + ' ≠ ' + tg.spec.height });
        }
      }
      if (!found) occ.push({ file: APP_WXSS_REL, line: 1, term: '未找到 .' + tg.cls + ' 规则块' });
    }
    c.notes.push('在扫描到的 *.wxss 中定位 .btn-primary / .btn-secondary 规则块，比对 designTokens.buttonSizes 的 width/height');
    results.push(makeResult(def, c.severity, c.rule, c.refs,
      occ.length ? 'FAIL' : 'PASS', occ.length,
      occ.slice(0, 5).map(function (o) { return o.file + ':' + o.line + ' | ' + o.term; }), c.notes));
  }

  // C13 设计稿快照锚点一致（版本声明 + 23 屏骨架 + 路由映射）
  {
    const def = CHECK_DEFS[12], c = ctx(def);
    const occ = [];
    const drLine = lineAt(manifestText, manifestText.indexOf('"designRef"'));
    const ref = (manifest.meta && manifest.meta.designRef) || null;
    const snapRel = (ref && typeof ref.snapshot === 'string' && ref.snapshot) || SNAPSHOT_DEFAULT_REL;
    const two = function (n) { return n < 10 ? '0' + n : String(n); };
    if (!ref) {
      occ.push({ file: MANIFEST_REL, line: drLine, term: 'meta.designRef 缺失，无法锚定云端画布版本' });
    } else {
      const snap = safeJson(snapRel);
      if (!snap || typeof snap !== 'object') {
        occ.push({ file: snapRel, line: 1, term: '设计稿结构快照缺失或 JSON 不可解析' });
      } else {
        const sm = snap.meta || {};
        if (String(sm.fileId) !== String(ref.fileId)) {
          occ.push({ file: snapRel, line: 1, term: 'fileId 不一致: 快照=' + sm.fileId + ' manifest=' + ref.fileId });
        }
        if (String(sm.snapshotVersion) !== String(ref.snapshotVersion)) {
          occ.push({ file: snapRel, line: 1, term: 'snapshotVersion 不一致: 快照=' + sm.snapshotVersion + ' manifest=' + ref.snapshotVersion });
        }
        const screens = Array.isArray(snap.screens) ? snap.screens : [];
        const expectedCount = (typeof ref.screenCount === 'number' && ref.screenCount > 0) ? ref.screenCount : 23;
        if (screens.length !== expectedCount) {
          occ.push({ file: snapRel, line: 1, term: '快照屏数 ' + screens.length + ' ≠ 期望 ' + expectedCount });
        }
        for (let i = 1; i <= expectedCount; i++) {
          const k = two(i);
          const s = screens.filter(function (x) { return String(x && x.screen) === k; })[0];
          if (!s) { occ.push({ file: snapRel, line: 1, term: '缺少屏 ' + k }); continue; }
          const mapped = (manifest.screenToRoute || {})[k];
          if (!mapped || String(s.route) !== String(mapped.route)) {
            occ.push({ file: snapRel, line: 1, term: '屏 ' + k + ' route=' + s.route + ' ≠ screenToRoute=' + (mapped && mapped.route) });
          }
          if (!s.nodeId || !s.phoneNodeId) {
            occ.push({ file: snapRel, line: 1, term: '屏 ' + k + ' 缺 nodeId / phoneNodeId' });
          }
          if (!Array.isArray(s.contentBlocks) || s.contentBlocks.length === 0) {
            occ.push({ file: snapRel, line: 1, term: '屏 ' + k + ' contentBlocks 为空，骨架不可比对' });
          }
        }
      }
    }
    c.notes.push('锚点 = manifest.meta.designRef(fileId / snapshotVersion / screenCount) ↔ ' + snapRel + ' 的 meta 与 screens');
    c.notes.push('同时核对每屏 route 等于 manifest.screenToRoute.route，且 nodeId / phoneNodeId / contentBlocks 齐全');
    c.notes.push('边界：本检查是离线版本锚点，不能自动感知云端画布是否改动；画布改版须重导快照并同步递增版本，否则两侧声明会分叉');
    results.push(makeResult(def, c.severity, c.rule, c.refs,
      occ.length ? 'FAIL' : 'PASS', occ.length,
      occ.slice(0, 5).map(function (o) { return o.file + ':' + o.line + ' | ' + o.term; }), c.notes));
  }

  return results;
}

// ---------------------------------------------------------------------------
// 汇总与输出
// ---------------------------------------------------------------------------
function pad(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

function buildSummary(results) {
  let pass = 0, warn = 0, fail = 0, p0Fail = 0, p1Fail = 0, p2Fail = 0;
  for (const r of results) {
    if (r.status === 'PASS') pass++;
    else if (r.status === 'WARN') warn++;
    else if (r.status === 'FAIL') {
      fail++;
      if (r.severity === 'P0') p0Fail++;
      else if (r.severity === 'P1') p1Fail++;
      else if (r.severity === 'P2') p2Fail++;
    }
  }
  const verdict = p0Fail > 0 ? 'FAIL' : 'PASS';
  const exitCode = p0Fail > 0 ? 1 : 0; // 仅 P0 FAIL 触发 exit 1；WARN 不影响
  let score = 100 - 15 * p0Fail - 5 * p1Fail - 1 * warn;
  if (score < 0) score = 0; // 下限 0
  return {
    total: results.length, pass: pass, warn: warn, fail: fail,
    p0Fail: p0Fail, p1Fail: p1Fail, p2Fail: p2Fail,
    verdict: verdict, exitCode: exitCode, score: score,
    scoreBreakdown: {
      base: 100,
      p0FailPenalty: -15 * p0Fail,
      p1FailPenalty: -5 * p1Fail,
      warnPenalty: -1 * warn,
      p2FailPenalty: 0,
      note: 'P2 FAIL 不在本加权规则内，不计扣分（但仍计入 fail 总数）'
    },
    disclaimer: DISCLAIMER
  };
}

function fatal(message, errors) {
  const payload = {
    fatal: true, error: message, errors: errors || [],
    exitCode: 2, disclaimer: DISCLAIMER, fileWarnings: fileWarnings
  };
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write('[FATAL] manifest 不可用，未执行任何检查（exit code = 2）\n');
    process.stdout.write('  ' + message + '\n');
    for (const e of (errors || [])) process.stdout.write('  - ' + e + '\n');
    process.stdout.write('  [!] ' + DISCLAIMER + '\n');
    if (fileWarnings.length) {
      process.stdout.write('  文件读取 warning: ' + fileWarnings.length + ' 条\n');
      for (const w of fileWarnings) process.stdout.write('    - ' + w.file + ': ' + w.error + '\n');
    }
  }
  process.exitCode = 2;
}

function printHuman(payload) {
  const L = [];
  L.push('================================================================================');
  L.push(' 出摊吧 · 设计符合度静态自检  check-design-parity.js  (Team C / C5 石渠)');
  L.push(' manifest : ' + payload.manifest + '  v' + payload.manifestVersion);
  const dr = payload.designRef || {};
  L.push(' 设计锚点 : fileId=' + (dr.fileId || '(未声明)') +
         '  snapshotVersion=' + (dr.snapshotVersion || '(未声明)') +
         '  screens=' + (dr.screenCount || '?'));
  L.push(' 扫描范围 : include=' + JSON.stringify(payload.scan.include));
  L.push('            exclude=' + JSON.stringify(payload.scan.exclude));
  L.push(' 命中文件 : ' + payload.scan.scannedCount + ' 个  ' +
         '(wxml=' + payload.scan.byExt.wxml + ' wxss=' + payload.scan.byExt.wxss +
         ' js=' + payload.scan.byExt.js + ' json=' + payload.scan.byExt.json + ')');
  L.push('--------------------------------------------------------------------------------');
  L.push(' ID   | SEV | STATUS | 命中数 | 前 5 条证据(文件:行)');
  L.push('--------------------------------------------------------------------------------');
  for (const r of payload.checks) {
    const ev = r.evidence.length ? r.evidence.join(' ; ') : '-';
    L.push(' ' + pad(r.id, 5) + '| ' + pad(r.severity, 4) + '| ' + pad(r.status, 7) + '| ' +
           pad(r.hits, 7) + '| ' + ev);
  }
  L.push('--------------------------------------------------------------------------------');
  L.push(' 检查依据 / 明细（severity 与 rule 取自 manifest.acceptance.checks 语义对应条目）');
  for (const r of payload.checks) {
    L.push(' [' + r.id + '] ' + r.title + '  [' + r.severity + '] ' + r.status + '  命中=' + r.hits);
    L.push('     basis    : ' + r.basis);
    L.push('     rule     : ' + r.rule);
    L.push('     ruleRefs : ' + (r.ruleRefs.length ? r.ruleRefs.join(', ') : '(rule 未引用可解析的 manifest 字段)'));
    for (const n of r.notes) L.push('     note     : ' + n);
    if (r.evidence.length) {
      L.push('     evidence : ' + r.evidence.join(' ; '));
    }
  }
  L.push('================================================================================');
  const s = payload;
  L.push(' 汇总 : total=' + s.total + ' pass=' + s.pass + ' warn=' + s.warn + ' fail=' + s.fail +
         ' p0Fail=' + s.p0Fail + ' verdict=' + s.verdict);
  L.push('        (p1Fail=' + s.p1Fail + ' p2Fail=' + s.p2Fail + ')');
  L.push(' 设计稿符合度参考分 : ' + s.score + ' / 100');
  L.push('   加权 = 100 - 15*P0FAIL(' + s.p0Fail + ') - 5*P1FAIL(' + s.p1Fail + ') - 1*WARN(' + s.warn + ')，下限 0');
  L.push('   ' + s.scoreBreakdown.note);
  L.push(' [!] ' + s.disclaimer);
  if (s.baselineStale) {
    L.push(' [!!] 设计稿快照锚点不一致（C13 FAIL）：本地规则基线可能已过期。');
    L.push('      请重新导出画布结构快照并同步递增 tools/design-snapshot.json 与 manifest 的 snapshotVersion。');
  }
  L.push(' 文件读取 warning : ' + s.fileWarnings.length + ' 条');
  for (const w of s.fileWarnings) L.push('    - ' + w.file + ': ' + w.error);
  L.push(' P0 FAIL 触发 exit code = 1；WARN 不影响 exit code。');
  L.push(' exit code : ' + s.exitCode);
  L.push('================================================================================');
  process.stdout.write(L.join('\n') + '\n');
}

function main() {
  const raw = safeRead(MANIFEST_REL);
  let manifest = null;
  let parseErr = null;
  if (raw === null) {
    parseErr = 'manifest 文件读取失败（详见 fileWarnings）';
  } else {
    try { manifest = JSON.parse(raw); }
    catch (e) { parseErr = 'manifest JSON 解析失败: ' + ((e && e.message) || e); }
  }
  if (parseErr) return fatal(parseErr, []);
  const errors = validateManifest(manifest);
  if (errors.length) return fatal('manifest 字段校验未通过', errors);

  const scanned = collectScanned(manifest);
  const byExt = groupByExt(scanned);
  const results = runChecks(manifest, scanned, byExt);
  const summary = buildSummary(results);

  const payload = Object.assign({
    tool: 'check-design-parity',
    manifest: MANIFEST_REL,
    manifestVersion: (manifest.meta && manifest.meta.version) || '(未提供)',
    designRef: (manifest.meta && manifest.meta.designRef) || null,
    scan: {
      include: manifest.scope.scanInclude,
      exclude: manifest.scope.scanExclude,
      scannedCount: scanned.length,
      byExt: {
        wxml: byExt.wxml.length, wxss: byExt.wxss.length,
        js: byExt.js.length, json: byExt.json.length
      }
    },
    checks: results,
    fileWarnings: fileWarnings,
    manifestErrors: [],
    // 机器可读：C13 FAIL 表示本地规则基线相对画布快照已分叉，需重导快照
    baselineStale: results.some(function (r) { return r.id === 'C13' && r.status === 'FAIL'; })
  }, summary);

  if (JSON_MODE) process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  else printHuman(payload);
  process.exitCode = summary.exitCode;
}

main();

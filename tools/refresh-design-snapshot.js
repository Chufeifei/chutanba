#!/usr/bin/env node
/**
 * ============================================================================
 * tools/refresh-design-snapshot.js
 * 出摊吧 · 一期 MVP 设计稿「离线结构锚点」刷新工具（Phase 5 / TOOL-2 / T44）
 * ----------------------------------------------------------------------------
 * 【核心声明】
 * 这是离线锚点刷新协议，不能自动感知云端画布改动。
 * 本工具不联网、不调用任何画布 / Ardot API，只读取项目内文件与「由设计侧导出的
 * 快照 JSON」。云端画布（fileId 743864343511294）一旦改版，本工具无法自行发现，
 * 必须由具备画布读取能力的一方重新导出快照、递增 snapshotVersion，并由维护者
 * 同步递增 tools/design-parity-manifest.json 的 meta.designRef.snapshotVersion；
 * 否则 tools/check-design-parity.js 的 C13 会判为锚点不一致（baselineStale=true）。
 *
 * 【两种模式】
 *  1) 刷新模式：node tools/refresh-design-snapshot.js <设计侧导出的快照.json>
 *     校验导出快照的结构完整性；通过后才覆盖写入 tools/design-snapshot.json，
 *     并输出「需同步递增 manifest.meta.designRef.snapshotVersion」的明确提示。
 *     本工具刻意「不自动改 manifest」，以保留 C13「两侧声明须人工对齐」的闭环，
 *     避免脚本静默改一侧而破坏锚点一致性判定。
 *  2) 只读核对模式：node tools/refresh-design-snapshot.js --check
 *     只读取当前 tools/design-snapshot.json 与 tools/design-parity-manifest.json，
 *     校验二者是否一致，并把结论以「合法 JSON」输出；全程不写任何文件。
 *
 * 【校验项（导出快照）】
 *   · meta.snapshotVersion 存在且非空
 *   · meta.fileId 必须等于 743864343511294
 *   · 23 屏齐全（01~23 唯一），每屏有 nodeId / phoneNodeId / contentBlocks(非空)
 *     / cta(数组，可为空) / route
 *   · 每屏 route 与 tools/design-parity-manifest.json 的 screenToRoute 一致
 *   · 组件库 componentLibrary.nodeId === "3:1" 与画布外备注区 nonPageNodes 存在
 *
 * 【退出码】
 *   参数错误、结构不合法、文件缺失 / 不可解析、--check 判为不一致：非零退出 + 中文错误
 *   --check 判为一致 / 刷新成功：0
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ---- 常量：与项目基线、C13 规则保持单一真相源 ----
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.join(PROJECT_ROOT, 'tools', 'design-snapshot.json');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'tools', 'design-parity-manifest.json');
const REL_SNAPSHOT = 'tools/design-snapshot.json';
const REL_MANIFEST = 'tools/design-parity-manifest.json';

const FILE_ID = '743864343511294';
const COMPONENT_LIBRARY_NODE_ID = '3:1';
const SCREEN_COUNT = 23;
const BRANCH_SCREENS = ['17', '18', '19', '20', '21', '22', '23'];

const USAGE = [
  '用法：',
  '  node tools/refresh-design-snapshot.js --check',
  '      只读核对当前快照与 manifest 是否一致，输出合法 JSON，不写任何文件。',
  '  node tools/refresh-design-snapshot.js <设计侧导出的快照.json>',
  '      校验结构完整性，通过后写入 tools/design-snapshot.json，并提示同步递增 manifest 版本。',
  '  node tools/refresh-design-snapshot.js --help',
  '      显示本说明。',
  '',
  '注意：这是离线锚点刷新协议，不能自动感知云端画布改动。',
].join('\n');

function two(n) { return n < 10 ? '0' + n : String(n); }

function emitJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function failChinese(msg) {
  process.stderr.write('【错误】' + msg + '\n');
}

function readJsonOrThrow(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(label + ' 读取失败（' + filePath + '）：' + e.message);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(label + ' 不是合法 JSON（' + filePath + '）：' + e.message);
  }
}

/**
 * 校验一份快照对象的结构完整性（导出快照与当前快照通用）。
 * routeMap 取自 manifest.screenToRoute；为 null 时跳过 route 一致性比对。
 * 返回 { checks, issues }：checks = [{ id, ok, detail }]，issues = 中文问题串数组。
 */
function validateSnapshotStructure(snap, routeMap) {
  const checks = [];
  const issues = [];
  const add = function (id, ok, detail) {
    checks.push({ id: id, ok: !!ok, detail: detail });
    if (!ok) issues.push(detail);
  };

  if (!snap || typeof snap !== 'object' || Array.isArray(snap)) {
    add('shape.root', false, '快照根节点必须是 JSON 对象');
    return { checks: checks, issues: issues };
  }

  const meta = snap.meta && typeof snap.meta === 'object' && !Array.isArray(snap.meta)
    ? snap.meta : null;
  add('meta.snapshotVersion',
    !!(meta && typeof meta.snapshotVersion === 'string' && meta.snapshotVersion.trim() !== ''),
    'meta.snapshotVersion 缺失或为空（必须存在且非空）');
  add('meta.fileId',
    !!(meta && String(meta.fileId) === FILE_ID),
    'meta.fileId 必须等于 ' + FILE_ID + '，实际=' + (meta ? meta.fileId : '(无 meta)'));

  const comp = snap.componentLibrary && typeof snap.componentLibrary === 'object'
    ? snap.componentLibrary : null;
  add('componentLibrary.3:1',
    !!(comp && String(comp.nodeId) === COMPONENT_LIBRARY_NODE_ID),
    '组件库节点 componentLibrary.nodeId 必须等于 ' + COMPONENT_LIBRARY_NODE_ID + '（组件库 3:1 缺失）');

  const notes = Array.isArray(snap.nonPageNodes) ? snap.nonPageNodes : [];
  const hasNoteArea = notes.some(function (n) {
    return !!n && typeof n.name === 'string' && /备注|评审|规则对照/.test(n.name);
  });
  add('nonPageNodes.noteArea', hasNoteArea,
    '备注区缺失：nonPageNodes 须含评审 / 规则对照类画布外备注节点');

  const screens = Array.isArray(snap.screens) ? snap.screens : [];
  add('screens.count', screens.length === SCREEN_COUNT,
    '快照屏数应为 ' + SCREEN_COUNT + '，实际=' + screens.length);

  // 以 screen 编号建索引，核对 01~23 齐全且唯一
  const byScreen = {};
  screens.forEach(function (s) {
    const k = s && s.screen !== undefined ? String(s.screen) : '';
    if (k) byScreen[k] = (byScreen[k] || 0) + 1;
  });
  const missing = [];
  const duplicated = [];
  for (let i = 1; i <= SCREEN_COUNT; i += 1) {
    const k = two(i);
    const c = byScreen[k] || 0;
    if (c === 0) missing.push(k);
    else if (c > 1) duplicated.push(k);
  }
  add('screens.coverage', missing.length === 0 && duplicated.length === 0,
    (missing.length || duplicated.length)
      ? ('屏编号不完整：缺少=[' + missing.join(',') + '] 重复=[' + duplicated.join(',') + ']')
      : '屏编号 01~23 齐全且唯一');

  // 逐屏字段 + route 与 screenToRoute 一致性
  for (let i = 1; i <= SCREEN_COUNT; i += 1) {
    const k = two(i);
    const s = screens.filter(function (x) { return x && String(x.screen) === k; })[0];
    if (!s) continue;
    const okNodeId = typeof s.nodeId === 'string' && s.nodeId.trim() !== '';
    const okPhone = typeof s.phoneNodeId === 'string' && s.phoneNodeId.trim() !== '';
    const okBlocks = Array.isArray(s.contentBlocks) && s.contentBlocks.length > 0;
    const okCta = Array.isArray(s.cta); // cta 字段必须存在且为数组；允许空数组
    const okRoute = typeof s.route === 'string' && s.route.trim() !== '';
    add('screen.' + k + '.fields', okNodeId && okPhone && okBlocks && okCta && okRoute,
      '屏 ' + k + ' 须具备 nodeId / phoneNodeId / contentBlocks(非空) / cta(数组) / route；'
      + 'nodeId=' + okNodeId + ' phoneNodeId=' + okPhone + ' contentBlocks=' + okBlocks
      + ' cta=' + okCta + ' route=' + okRoute);
    if (routeMap) {
      const mapped = routeMap[k];
      const matched = !!(mapped && String(s.route) === String(mapped.route));
      add('screen.' + k + '.route', matched,
        '屏 ' + k + ' route=' + s.route + ' 与 manifest.screenToRoute.' + k + '.route='
        + (mapped ? mapped.route : '(缺失)') + (matched ? ' 一致' : ' 不一致'));
    }
  }

  return { checks: checks, issues: issues };
}

/** 只读核对模式：当前快照 ↔ manifest 一致性，输出合法 JSON，不写任何文件。 */
function runCheck() {
  let snap;
  let manifest;
  try {
    snap = readJsonOrThrow(SNAPSHOT_PATH, REL_SNAPSHOT);
    manifest = readJsonOrThrow(MANIFEST_PATH, REL_MANIFEST);
  } catch (e) {
    failChinese(e.message);
    emitJson({
      mode: 'check',
      consistent: false,
      baselineStale: true,
      error: e.message,
    });
    process.exitCode = 1;
    return;
  }

  const designRef = (manifest.meta && manifest.meta.designRef) || {};
  const routeMap = (manifest.screenToRoute && typeof manifest.screenToRoute === 'object')
    ? manifest.screenToRoute : null;
  const base = validateSnapshotStructure(snap, routeMap);

  // 追加跨文档一致项（C13 锚点 version / fileId / screenCount）
  const extraChecks = [];
  const extraIssues = [];
  const pushExtra = function (id, ok, detail) {
    extraChecks.push({ id: id, ok: !!ok, detail: detail });
    if (!ok) extraIssues.push(detail);
  };
  const sm = (snap && snap.meta && typeof snap.meta === 'object') ? snap.meta : {};
  pushExtra('anchor.fileId', String(sm.fileId) === String(designRef.fileId),
    '快照 meta.fileId=' + sm.fileId + ' / manifest meta.designRef.fileId=' + designRef.fileId
    + (String(sm.fileId) === String(designRef.fileId) ? ' 一致' : ' 不一致'));
  pushExtra('anchor.snapshotVersion', String(sm.snapshotVersion) === String(designRef.snapshotVersion),
    '快照 meta.snapshotVersion=' + sm.snapshotVersion + ' / manifest meta.designRef.snapshotVersion='
    + designRef.snapshotVersion
    + (String(sm.snapshotVersion) === String(designRef.snapshotVersion) ? ' 一致' : ' 不一致'));
  pushExtra('anchor.screenCount',
    (Array.isArray(snap.screens) ? snap.screens.length : -1) === Number(designRef.screenCount),
    '快照屏数=' + (Array.isArray(snap.screens) ? snap.screens.length : -1)
    + ' / manifest meta.designRef.screenCount=' + designRef.screenCount);

  const checks = base.checks.concat(extraChecks);
  const issues = base.issues.concat(extraIssues);
  const consistent = issues.length === 0;

  emitJson({
    mode: 'check',
    consistent: consistent,
    baselineStale: !consistent,
    snapshot: REL_SNAPSHOT,
    manifest: REL_MANIFEST,
    fileId: FILE_ID,
    snapshotVersion: sm.snapshotVersion,
    manifestSnapshotVersion: designRef.snapshotVersion || null,
    screenCount: Array.isArray(snap.screens) ? snap.screens.length : 0,
    branchScreenCount: BRANCH_SCREENS.length,
    checkCount: checks.length,
    issues: issues,
    checks: checks,
    note: '这是离线锚点协议；本工具不联网、不读云端画布，无法自动感知云端画布改动。'
      + (consistent
        ? ' 当前快照与 manifest 判为一致（C13 锚点对齐，baselineStale=false）。'
        : ' 当前快照与 manifest 判为不一致，应重新导出快照并同步递增 manifest.meta.designRef.snapshotVersion。'),
  });

  if (!consistent) {
    failChinese('当前快照与 manifest 判为不一致（C13 锚点分叉，baselineStale=true）；'
      + '共 ' + issues.length + ' 项问题，详见 stdout 的 issues 数组。');
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

/** 刷新模式：校验导出快照 → 写入离线锚点 → 提示同步递增 manifest（不自动改）。 */
function runRefresh(inputPath) {
  const resolved = path.resolve(process.cwd(), inputPath);
  let exported;
  try {
    exported = readJsonOrThrow(resolved, '设计侧导出快照');
  } catch (e) {
    failChinese(e.message);
    process.exitCode = 1;
    return;
  }

  let manifest;
  try {
    manifest = readJsonOrThrow(MANIFEST_PATH, REL_MANIFEST);
  } catch (e) {
    failChinese(e.message);
    process.exitCode = 1;
    return;
  }
  const routeMap = (manifest.screenToRoute && typeof manifest.screenToRoute === 'object')
    ? manifest.screenToRoute : null;
  if (!routeMap) {
    failChinese('manifest 缺少 screenToRoute，无法校验导出快照的 route 一致性');
    process.exitCode = 1;
    return;
  }

  const result = validateSnapshotStructure(exported, routeMap);
  if (result.issues.length > 0) {
    failChinese('导出快照结构不合法，已拒绝写入 ' + REL_SNAPSHOT + '；共 '
      + result.issues.length + ' 项问题：');
    result.issues.forEach(function (m, i) {
      process.stderr.write('  ' + (i + 1) + '. ' + m + '\n');
    });
    process.exitCode = 1;
    return;
  }

  // 校验通过才写入：本工具唯一的写操作，且刻意不触碰 manifest。
  try {
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(exported, null, 2) + '\n', 'utf8');
  } catch (e) {
    failChinese('写入 ' + REL_SNAPSHOT + ' 失败：' + e.message);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('【刷新完成】已通过结构校验，导出快照已写入 ' + REL_SNAPSHOT
    + '（snapshotVersion=' + exported.meta.snapshotVersion + '，' + SCREEN_COUNT + ' 屏齐全）。\n');
  process.stdout.write('【必办】需同步递增 manifest.meta.designRef.snapshotVersion（'
    + REL_MANIFEST + '）为 ' + exported.meta.snapshotVersion
    + '，否则 tools/check-design-parity.js 的 C13 会判为锚点不一致、baselineStale=true。\n');
  process.stdout.write('【说明】本工具刻意不自动修改 manifest，以保留 C13「两侧声明须人工对齐」闭环；'
    + '这是离线锚点刷新协议，不能自动感知云端画布改动。\n');
  process.exitCode = 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.indexOf('--help') >= 0 || args.indexOf('-h') >= 0) {
    process.stdout.write(USAGE + '\n');
    process.exitCode = 0;
    return;
  }
  const flags = args.filter(function (a) { return a.charAt(0) === '-'; });
  const paths = args.filter(function (a) { return a.charAt(0) !== '-'; });
  const unknown = flags.filter(function (f) { return f !== '--check'; });
  if (unknown.length > 0) {
    failChinese('未知参数：' + unknown.join(' ') + '；仅支持 --check / --help 或一个快照路径。\n' + USAGE);
    process.exitCode = 1;
    return;
  }
  if (flags.indexOf('--check') >= 0) {
    if (paths.length > 0) {
      failChinese('--check 为只读模式，不接受快照路径参数；请勿同时传入路径。\n' + USAGE);
      process.exitCode = 1;
      return;
    }
    runCheck();
    return;
  }
  if (paths.length !== 1) {
    failChinese('参数错误：刷新模式必须且只能提供一个「由设计侧导出的快照 JSON 路径」。\n' + USAGE);
    process.exitCode = 1;
    return;
  }
  runRefresh(paths[0]);
}

if (require.main === module) {
  main();
}

module.exports = {
  validateSnapshotStructure: validateSnapshotStructure,
  FILE_ID: FILE_ID,
  SCREEN_COUNT: SCREEN_COUNT,
};

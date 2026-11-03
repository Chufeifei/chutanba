/**
 * 开摊截止时间候选（P09）。
 *
 * 需求要求「任何候选都须本人重新确认」，所以这里只负责把可选时段列出来，
 * 绝不让页面静默采用服务端默认值。
 *
 * 候选来源有两处：
 * 1. 服务端 openTimeCandidates —— 上次钟点换算出的今天／次日时刻，或 4 小时候选；
 * 2. 本地按 30 分钟步进生成的时段 —— 覆盖「现在 + 30 分钟」到「现在 + 12 小时」，
 *    与服务端 validatePlannedEnd 的 N < E ≤ N+12h 约束一致。
 *
 * 两者按时间点去重后排序；服务端默认候选标「推荐」，但仍需用户点选确认。
 */
const { SESSION_ROUND_STEP_MS, MAX_SESSION_DURATION_MS } = require('../../config/timing');
const { describeClock } = require('../../utils/clock');

const SOURCE_NOTE = Object.freeze({
  FOUR_HOURS: '推荐 · 4 小时后',
  TODAY: '推荐 · 今天同时段',
  TOMORROW: '推荐 · 次日同时段',
});

const LOCAL_NOTE = '';

function ceilToStep(ms) {
  return Math.ceil(ms / SESSION_ROUND_STEP_MS) * SESSION_ROUND_STEP_MS;
}

function makeOption(atMs, nowMs, note, recommended) {
  const text = describeClock(atMs, nowMs);
  return {
    atMs,
    text,
    note,
    recommended,
    // picker 的 range-key 只能指向一个字段，这里预拼好，避免 wxml 拼字符串
    pickerText: note ? `${text}（${note}）` : text,
  };
}

/**
 * @param {object} params
 * @param {object} params.candidates 服务端 openTimeCandidates
 * @param {number} params.nowMs
 * @returns {Array<{atMs:number,text:string,note:string,recommended:boolean,pickerText:string}>}
 */
function buildCutoffOptions({ candidates, nowMs }) {
  const map = new Map();
  const add = (atMs, note, recommended) => {
    if (!Number.isSafeInteger(atMs)) return;
    const exist = map.get(atMs);
    if (exist) {
      if (recommended) exist.recommended = true;
      return;
    }
    map.set(atMs, makeOption(atMs, nowMs, note, recommended));
  };

  const source = candidates || {};
  const fallback = source.defaultCandidate;
  if (fallback) {
    add(fallback.atMs, SOURCE_NOTE[fallback.label] || '推荐', true);
  }
  if (source.today) add(source.today.atMs, '今天同时段', false);
  if (source.tomorrow) add(source.tomorrow.atMs, '次日同时段', false);

  const start = ceilToStep(nowMs + SESSION_ROUND_STEP_MS);
  const end = nowMs + MAX_SESSION_DURATION_MS;
  for (let atMs = start; atMs <= end; atMs += SESSION_ROUND_STEP_MS) {
    add(atMs, LOCAL_NOTE, false);
  }

  return Array.from(map.values()).sort((a, b) => a.atMs - b.atMs);
}

/**
 * 选中项下标。轮询会重建候选列表，必须保住摊主已经选好的那个时间点。
 * @param {Array} options
 * @param {number} [keepAtMs] 之前选定的截止时刻
 */
function resolveIndex(options, keepAtMs) {
  const list = options || [];
  if (keepAtMs) {
    const kept = list.findIndex((item) => item.atMs === keepAtMs);
    if (kept >= 0) return kept;
  }
  const recommended = list.findIndex((item) => item.recommended);
  return recommended >= 0 ? recommended : 0;
}

module.exports = { buildCutoffOptions, resolveIndex };

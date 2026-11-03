/**
 * 营业时间与阶段派生的纯函数。
 * 口径见 doc/MVP/一期技术设计.md §4 与 prd R2/R7：上海固定 UTC+8（无夏令时），
 * 全部以毫秒安全整数运算，不使用 Date 本地时区，避免部署机器时区影响业务判断。
 */
const { DomainError } = require('../../domain/errors');

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const HALF_HOUR_MS = 1_800_000;
const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * HOUR_MS;
const MAX_WINDOW_MS = 12 * HOUR_MS;
const MAX_PREPARING_MS = HOUR_MS;
const MINUTES_PER_DAY = 1440;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function assertSafeMs(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} 必须是毫秒安全整数`);
  }
  return value;
}

/** 当地日历日：先平移到 UTC+8 再取 UTC 日期部分。 */
function shanghaiDateKey(ms) {
  const shifted = new Date(assertSafeMs(ms, 'ms') + SHANGHAI_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** 当地日内分钟（0～1439），用于写入 last_selected_clock_min。 */
function shanghaiClockMin(ms) {
  return Math.floor(((assertSafeMs(ms, 'ms') + SHANGHAI_OFFSET_MS) % DAY_MS) / MINUTE_MS);
}

/** 由当地日期与日内分钟反算绝对毫秒。 */
function clockOnDate(dateKey, clockMin) {
  const match = DATE_KEY_PATTERN.exec(String(dateKey));
  if (!match || !Number.isInteger(clockMin) || clockMin < 0 || clockMin >= MINUTES_PER_DAY) {
    throw new TypeError('日期或日内分钟不合法');
  }
  const utcMidnightMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return utcMidnightMs - SHANGHAI_OFFSET_MS + clockMin * MINUTE_MS;
}

function addDays(dateKey, days) {
  return shanghaiDateKey(clockOnDate(dateKey, 0) + days * DAY_MS);
}

/** 恰好落在 30 分钟点时保持不变，只有越过边界才前进一格。 */
/**
 * 「自某时刻起 N 个上海自然日」：R-08 口径为 [起始时刻, 第 N 日相同本地钟点)。
 * 走当地日历日推进再回到同一钟点，不把天数折算成固定毫秒常量；
 * 跨月、跨年与闰日都由日历推进兜住。
 */
function addShanghaiDays(ms, days) {
  const atMs = assertSafeMs(ms, 'ms');
  if (!Number.isInteger(days)) throw new TypeError('自然日天数必须是整数');
  const targetKey = addDays(shanghaiDateKey(atMs), days);
  return clockOnDate(targetKey, shanghaiClockMin(atMs));
}

function roundUpToHalfHour(ms) {
  return Math.ceil(assertSafeMs(ms, 'ms') / HALF_HOUR_MS) * HALF_HOUR_MS;
}

function toCandidate(atMs, label) {
  return { atMs, dateKey: shanghaiDateKey(atMs), clockMin: shanghaiClockMin(atMs), label };
}

function isWithinWindow(nowMs, atMs) {
  return atMs > nowMs && atMs - nowMs <= MAX_WINDOW_MS;
}

/**
 * 时间候选：优先沿用上次成功开摊的钟点（今天／次日），
 * 都不在 12 小时窗口内时回退到「现在 +4 小时」向上取整的候选。
 */
function buildOpenTimeCandidates({ nowMs, lastSelectedClockMin }) {
  const fallback = toCandidate(roundUpToHalfHour(nowMs + 4 * HOUR_MS), 'FOUR_HOURS');
  if (!Number.isInteger(lastSelectedClockMin)
    || lastSelectedClockMin < 0 || lastSelectedClockMin >= MINUTES_PER_DAY) {
    return { defaultCandidate: fallback };
  }
  const todayKey = shanghaiDateKey(nowMs);
  const todayAt = clockOnDate(todayKey, lastSelectedClockMin);
  const tomorrowKey = addDays(todayKey, 1);
  const tomorrowAt = clockOnDate(tomorrowKey, lastSelectedClockMin);
  const result = {};
  if (isWithinWindow(nowMs, todayAt)) {
    result.today = { atMs: todayAt, dateKey: todayKey, clockMin: lastSelectedClockMin };
  }
  if (isWithinWindow(nowMs, tomorrowAt)) {
    result.tomorrow = { atMs: tomorrowAt, dateKey: tomorrowKey, clockMin: lastSelectedClockMin };
  }
  const preferred = result.today || result.tomorrow;
  result.defaultCandidate = preferred
    ? { ...preferred, label: result.today ? 'TODAY' : 'TOMORROW' }
    : fallback;
  return result;
}

/** 写入口唯一的时间受理规则：必须在未来且不超过 12 小时。 */
function validatePlannedEnd({ nowMs, plannedEndAtMs }) {
  if (!Number.isSafeInteger(plannedEndAtMs)) {
    throw new DomainError('TIME_INVALID', '结束时间必须是毫秒时间戳');
  }
  if (plannedEndAtMs <= nowMs) throw new DomainError('TIME_INVALID', '结束时间必须晚于当前时刻');
  if (plannedEndAtMs - nowMs > MAX_WINDOW_MS) {
    throw new DomainError('TIME_INVALID', '结束时间不得晚于当前时刻 12 小时');
  }
  return plannedEndAtMs;
}

/**
 * 阶段按同一权威时刻派生：准备期取营业时长的 25%，上限 60 分钟。
 * 准备收摊仍属出摊中；remainingMs 为 0 时一律休息。
 */
function derivePhase({ nowMs, startedAtMs, plannedEndAtMs }) {
  const remainingMs = plannedEndAtMs - nowMs;
  if (remainingMs <= 0) return { phase: 'RESTING', remainingMs: 0 };
  const preparingMs = Math.min(Math.floor((plannedEndAtMs - startedAtMs) / 4), MAX_PREPARING_MS);
  return { phase: remainingMs > preparingMs ? 'OPEN' : 'PREPARING', remainingMs };
}

module.exports = {
  MINUTE_MS,
  HOUR_MS,
  DAY_MS,
  MAX_WINDOW_MS,
  shanghaiDateKey,
  shanghaiClockMin,
  clockOnDate,
  addDays,
  addShanghaiDays,
  roundUpToHalfHour,
  buildOpenTimeCandidates,
  validatePlannedEnd,
  derivePhase,
};

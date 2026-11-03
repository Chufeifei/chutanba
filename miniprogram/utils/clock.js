/**
 * 营业时间与阶段的时间计算（纯函数）。
 *
 * 全部按 Asia/Shanghai 固定时区计算（需求 R-08），不依赖设备时区设置。
 *
 * 重要边界：这里算出来的剩余时间只用于显示。
 * 是否可以开摊、导航、提交反馈，一律以服务端按主库时刻返回的结果为准；
 * 客户端时钟不可信，临近截止和恢复前台都必须重新向服务端复核。
 */
const timing = require('../config/timing');

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 把时间点换算成上海当地的年月日时分。 */
function toShanghaiParts(ms) {
  const date = new Date(Number(ms) + SHANGHAI_OFFSET_MS);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

/** 上海当地自然日的起始时间点（当地 00:00 对应的 UTC 毫秒）。 */
function startOfShanghaiDay(ms) {
  const parts = toShanghaiParts(ms);
  return Date.UTC(parts.year, parts.month - 1, parts.day) - SHANGHAI_OFFSET_MS;
}

function formatClock(ms) {
  const parts = toShanghaiParts(ms);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/** "今天 21:30" / "次日 01:00" / "10-28 21:30"，用于 P09 的时间选择器。 */
function describeClock(ms, referenceMs) {
  const target = toShanghaiParts(ms);
  const todayStart = startOfShanghaiDay(referenceMs);
  const dayDiff = Math.round((startOfShanghaiDay(ms) - todayStart) / (24 * 60 * 60 * 1000));
  const clock = `${String(target.hour).padStart(2, '0')}:${String(target.minute).padStart(2, '0')}`;
  if (dayDiff === 0) return `今天 ${clock}`;
  if (dayDiff === 1) return `次日 ${clock}`;
  return `${String(target.month).padStart(2, '0')}-${String(target.day).padStart(2, '0')} ${clock}`;
}

/** 剩余时长的可读文案，只用于展示。 */
function formatRemaining(remainingMs) {
  if (remainingMs <= 0) return '已到期';
  const totalMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}

/**
 * 需求 V-02.2：从未有有效上次选择时，默认推荐"当前时间后 4 小时，并向上取整到最近的 30 分钟"。
 */
function defaultPlannedEnd(nowMs) {
  const raw = Number(nowMs) + timing.DEFAULT_SESSION_DURATION_MS;
  return Math.ceil(raw / timing.SESSION_ROUND_STEP_MS) * timing.SESSION_ROUND_STEP_MS;
}

/**
 * 生成时间候选，供 P09 的 D02 选择器使用。
 * 只给候选，是否可用由服务端在提交时按 N<E 与 12 小时上限重验。
 */
function buildClockOptions(nowMs, count = 8) {
  const first = defaultPlannedEnd(nowMs);
  const options = [];
  for (let index = 0; index < count; index += 1) {
    const value = first + index * timing.SESSION_ROUND_STEP_MS;
    options.push({
      value,
      label: describeClock(value, nowMs),
      clock: formatClock(value),
    });
  }
  return options;
}

/**
 * 需求 V-02.2：上次成功选择的钟点按本次"今天／次日"换算，仍满足约束时才作为候选。
 * 早于当前时刻的钟点按次日理解。
 */
function clockMinuteToNextOccurrence(clockMinute, nowMs) {
  const minute = Number(clockMinute);
  if (!Number.isFinite(minute) || minute < 0 || minute >= 24 * 60) return null;
  const todayStart = startOfShanghaiDay(nowMs);
  const candidate = todayStart + minute * 60 * 1000;
  return candidate > Number(nowMs) ? candidate : candidate + 24 * 60 * 60 * 1000;
}

/** 展示用的阶段推导；真实阶段以服务端 phase 字段为准。 */
function derivePhase({ startedAtMs, plannedEndAtMs, nowMs }) {
  const remainingMs = Number(plannedEndAtMs) - Number(nowMs);
  if (remainingMs <= 0) return { phase: 'RESTING', remainingMs };
  const threshold = Math.min((Number(plannedEndAtMs) - Number(startedAtMs)) * 0.25, 60 * 60 * 1000);
  return { phase: remainingMs > threshold ? 'OPEN' : 'PREPARING', remainingMs };
}

module.exports = {
  SHANGHAI_OFFSET_MS,
  toShanghaiParts,
  startOfShanghaiDay,
  formatClock,
  describeClock,
  formatRemaining,
  defaultPlannedEnd,
  buildClockOptions,
  clockMinuteToNextOccurrence,
  derivePhase,
};

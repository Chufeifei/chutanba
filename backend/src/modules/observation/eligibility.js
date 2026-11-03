/**
 * 反馈受理窗口（纯函数，唯一判定点）。
 *
 * 口径出处：doc/MVP/一期数据模型与接口约定.md §4 L86-L87 ——
 * 营业中可提交；显式结束后 N < ended_at_ms + 30 分钟；到期作业未落终态时
 * 以 planned_end_at_ms 作为有效结束；恰好 30 分钟关闭（严格小于）。
 *
 * 领取、候选、反馈提交、FEEDBACK 定位上下文签发四处必须调用本文件，
 * 禁止各处自写比较式（沿用 W5「资格谓词单点」的做法）。
 */
const WINDOW_AFTER_END_MS = 30 * 60 * 1000;

/** 同时接受库行（snake_case）与规范化对象（camelCase），避免调用方各自改名出错。 */
function pick(row, camel, snake) {
  return row[camel] !== undefined ? row[camel] : row[snake];
}

function requiredMs(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${field} 必须是毫秒安全整数`);
  }
  return parsed;
}

/** 有效结束时刻：已结束取 ended_at_ms，否则用 planned_end_at_ms（到期未落终态同口径）。 */
function effectiveEndMs(row) {
  const ended = pick(row, 'endedAtMs', 'ended_at_ms');
  if (ended !== null && ended !== undefined) return requiredMs(ended, 'endedAtMs');
  return requiredMs(pick(row, 'plannedEndAtMs', 'planned_end_at_ms'), 'plannedEndAtMs');
}

function eligibleUntilMs(row) {
  return effectiveEndMs(row) + WINDOW_AFTER_END_MS;
}

function isEligible(row, nowMs) {
  return nowMs < eligibleUntilMs(row);
}

module.exports = {
  WINDOW_AFTER_END_MS,
  effectiveEndMs,
  eligibleUntilMs,
  isEligible,
};

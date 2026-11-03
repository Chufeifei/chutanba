/**
 * 展示格式化（纯函数）。
 *
 * 只做"把服务端结构变成可读文本"，不参与任何业务判断。
 * 后端字段为 snake_case 时，转换发生在 services 的 mapper，不在这里 ——
 * 这里收到的已经是页面可直接渲染的形态。
 */
const { toShanghaiParts } = require('./clock');

/** 距离展示：小于 1 公里用米，超过用公里（保留一位小数）。 */
function formatDistance(distanceM) {
  const value = Number(distanceM);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1000) return `${Math.round(value)} 米`;
  return `${(value / 1000).toFixed(1)} 公里`;
}

/** 时间点展示：今天 / 次日 / 月-日 + 时分。 */
function formatMoment(ms, referenceMs = Date.now()) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '';
  const target = toShanghaiParts(value);
  const today = toShanghaiParts(referenceMs);
  const clock = `${String(target.hour).padStart(2, '0')}:${String(target.minute).padStart(2, '0')}`;
  if (target.year === today.year && target.month === today.month && target.day === today.day) {
    return `今天 ${clock}`;
  }
  return `${String(target.month).padStart(2, '0')}-${String(target.day).padStart(2, '0')} ${clock}`;
}

/** 自然日展示：YYYY-MM-DD → MM-DD（保留跨年信息）。 */
function formatOpenDate(openDate) {
  if (typeof openDate !== 'string' || openDate.length < 10) return openDate || '';
  return openDate.slice(5);
}

/** 文本摘要：超出上限截断并加省略号，避免长公告撑破卡片。 */
function truncate(text, maxLength = 40) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return '';
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}

/** 计数展示：用于"累计出摊 N 天"。 */
function formatCount(count, unit) {
  const value = Number(count);
  if (!Number.isFinite(value) || value < 0) return `0 ${unit}`;
  return `${value} ${unit}`;
}

module.exports = {
  formatDistance,
  formatMoment,
  formatOpenDate,
  truncate,
  formatCount,
};

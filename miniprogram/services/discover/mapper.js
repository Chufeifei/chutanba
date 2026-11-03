/**
 * 公开集合 → 卡片展示模型。
 *
 * 三条口径：
 * 1. 顺序完全采纳服务端（无定位时为稳定序，有定位时为距离升序并在服务端兜底），
 *    这里不排序 —— 一旦前端再排一次，列表、地图、详情的顺序就会各说各话；
 * 2. 剩余时间用服务端下发的时刻差计算，但只用于显示；能否导航仍要在线复核；
 * 3. 缺字段一律留空字符串，不补 0、不造"未知距离"，避免把缺省当成真实值。
 */
const { SESSION_PHASE, SESSION_PHASE_LABEL } = require('../../config/contracts');
const { getCategoryName, getCategoryEmoji } = require('../../config/categories');
const { formatMoment, formatDistance, truncate } = require('../../utils/formatter');
const { describeClock, formatRemaining } = require('../../utils/clock');

// 阶段色调只影响状态点颜色，资格判断永远在服务端
const PHASE_TONE = Object.freeze({
  [SESSION_PHASE.OPEN]: 'success',
  [SESSION_PHASE.PREPARING]: 'warning',
  [SESSION_PHASE.RESTING]: 'neutral',
});

function phaseToneOf(phase) {
  return PHASE_TONE[phase] || 'neutral';
}

function phaseLabelOf(phase) {
  return SESSION_PHASE_LABEL[phase] || '';
}

/**
 * @param {object} item 公开集合项（契约 §5.1）
 * @param {number} nowMs 参考时刻，用服务端 serverNowMs 或取数时刻
 * @returns {object} 可直接渲染的卡片模型
 */
function toCardModel(item, nowMs) {
  const plannedEndAtMs = Number(item.plannedEndAtMs);
  const remainingMs = Number.isFinite(plannedEndAtMs) ? Math.max(plannedEndAtMs - nowMs, 0) : 0;
  return {
    vendorId: String(item.vendorId),
    name: item.name || '',
    categoryName: getCategoryName(item.categoryCode),
    categoryEmoji: getCategoryEmoji(item.categoryCode),
    summary: truncate(item.regularItemsSummary, 40),
    phase: item.phase,
    phaseLabel: phaseLabelOf(item.phase),
    phaseTone: phaseToneOf(item.phase),
    plannedEndText: plannedEndAtMs ? describeClock(plannedEndAtMs, nowMs) : '',
    remainingText: plannedEndAtMs ? formatRemaining(remainingMs) : '',
    locatedText: item.lastLocatedAtMs ? formatMoment(item.lastLocatedAtMs, nowMs) : '',
    // distanceM 只有本次请求带了顾客定位才会出现；没有就不显示距离
    distanceText: typeof item.distanceM === 'number' ? formatDistance(item.distanceM) : '',
    hasLocation: Boolean(item.currentLocation),
  };
}

function toCardModels(items, nowMs) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => toCardModel(item, nowMs));
}

module.exports = { toCardModel, toCardModels, phaseLabelOf, phaseToneOf };

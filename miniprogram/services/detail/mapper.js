/**
 * 公开详情 → 页面展示模型。
 *
 * 三个分支必须严格区分（页面方案 §3.1 P02）：
 * - OPEN：有轮次、有位置更新时间，可以导航；
 * - RESTING：只有资料，**没有**位置；页面不得渲染坐标占位、距离或导航按钮；
 * - UNVIEWABLE：只有一句提示，不展示任何资料字段（本人停止或治理暂停时不留快照）。
 *
 * 服务端在非 OPEN 分支直接缺省 currentLocation / sessionSummary 字段，
 * 这里也不补 null 以外的默认值，避免"缺省"被当成"没有坐标但可导航"。
 */
const { AVAILABILITY, SESSION_PHASE } = require('../../config/contracts');
const { getCategoryName } = require('../../config/categories');
const { formatMoment } = require('../../utils/formatter');
const { describeClock, formatRemaining } = require('../../utils/clock');
const { phaseLabelOf, phaseToneOf } = require('../discover/mapper');

function toProfileModel(profile) {
  const source = profile || {};
  const priceDescription = source.priceDescription || '';
  const announcement = source.announcement || '';
  return {
    name: source.name || '',
    categoryName: getCategoryName(source.categoryCode),
    summary: source.regularItemsSummary || '',
    priceDescription,
    hasPrice: Boolean(priceDescription),
    announcement,
    hasAnnouncement: Boolean(announcement),
  };
}

/**
 * @param {object} detail GET /public/vendors/:id 的 data
 * @param {number} [nowMs] 参考时刻，默认用服务端 serverNowMs
 * @returns {object} 详情视图模型
 */
function toDetailModel(detail, nowMs) {
  const source = detail || {};
  const serverNowMs = Number(source.serverNowMs) || nowMs || Date.now();
  const availability = source.availability;

  if (availability === AVAILABILITY.UNVIEWABLE) {
    return {
      vendorId: String(source.vendorId || ''),
      availability,
      // 分支布尔值由 mapper 给出，wxml 不直接比较状态字符串
      isResting: false,
      notice: source.notice || '该摊位当前暂不可查看',
      profile: null,
      session: null,
      location: null,
    };
  }

  const profile = toProfileModel(source.profile);

  if (availability !== AVAILABILITY.OPEN) {
    // RESTING：资料可读，位置与导航一律不给
    return {
      vendorId: String(source.vendorId || ''),
      availability: AVAILABILITY.RESTING,
      isResting: true,
      notice: '',
      profile,
      session: null,
      location: null,
    };
  }

  const summary = source.sessionSummary || {};
  const plannedEndAtMs = Number(summary.plannedEndAtMs);
  // 剩余时间优先用服务端算好的值；缺失时才用参照时刻兜底，且只用于显示
  const remainingMs = Number.isFinite(Number(summary.remainingMs))
    ? Number(summary.remainingMs)
    : Math.max(plannedEndAtMs - serverNowMs, 0);

  return {
    vendorId: String(source.vendorId || ''),
    availability,
    isResting: false,
    notice: '',
    profile,
    session: {
      sessionId: String(summary.sessionId || ''),
      locationVersionId: String(summary.locationVersionId || ''),
      phase: summary.phase || SESSION_PHASE.OPEN,
      phaseLabel: phaseLabelOf(summary.phase),
      phaseTone: phaseToneOf(summary.phase),
      preparedToClose: summary.phase === SESSION_PHASE.PREPARING,
      plannedEndText: plannedEndAtMs ? describeClock(plannedEndAtMs, serverNowMs) : '',
      remainingText: plannedEndAtMs ? formatRemaining(remainingMs) : '',
    },
    // 只给可展示的位置描述，不给经纬度：导航坐标必须来自 navigation-launches
    location: source.currentLocation
      ? {
        hasLocation: true,
        locationName: source.currentLocation.locationName || '',
        locatedText: formatMoment(source.currentLocation.locatedAtMs, serverNowMs),
      }
      : null,
  };
}

module.exports = { toDetailModel };

/**
 * 摊主工作台读模型整形（P09）。
 *
 * 三条不能违反的口径：
 * 1. 阶段只取服务端下发的 phase，客户端不重算 —— 重算就会出现
 *    「列表说正常营业、详情说准备收摊」的两套结论。
 * 2. 两类限制分别表达：本人停止公开与治理暂停互不解除，不能合成一个开关。
 * 3. 「最后成功定位时间」与「前台同步时间」是两个概念：
 *    前者来自 currentLocation.locatedAtMs，后者来自页面自己的同步时刻，
 *    混在一起就等于把旧位置说成后台实时跟踪。
 */
const { SESSION_PHASE, SESSION_PHASE_LABEL, ELIGIBILITY_REASON_LABEL } = require('../../config/contracts');
const { formatMoment, formatCount } = require('../../utils/formatter');
const { formatRemaining, describeClock } = require('../../utils/clock');

const PHASE_TONE = Object.freeze({
  [SESSION_PHASE.OPEN]: 'success',
  [SESSION_PHASE.PREPARING]: 'warning',
  [SESSION_PHASE.RESTING]: 'neutral',
});

function toRestriction({ selfStopped, governancePaused }) {
  const notes = [];
  if (selfStopped) notes.push('已停止公开');
  if (governancePaused) notes.push('治理暂停中');
  return {
    selfStopped,
    governancePaused,
    hasRestriction: notes.length > 0,
    notes,
    noteText: notes.join('；'),
  };
}

function toEligibility(eligibility) {
  const reasons = (eligibility && Array.isArray(eligibility.reasons)) ? eligibility.reasons : [];
  const texts = reasons.map((reason) => ELIGIBILITY_REASON_LABEL[reason] || reason);
  return {
    eligible: Boolean(eligibility && eligibility.eligible),
    reasonTexts: texts,
    reasonText: texts.join('；'),
    // SESSION_ACTIVE 表示当前已在营业，不是「不能开摊」的原因之外的错误
    hasActiveProfile: Boolean(eligibility && eligibility.activeProfileAvailable),
  };
}

/**
 * @param {object} raw GET /vendor/workbench 的 data
 * @param {number} [nowMs] 本机参考时刻，仅用于把服务端毫秒时间转成文案
 */
function toWorkbenchModel(raw, nowMs = Date.now()) {
  const data = raw || {};
  const phase = data.phase || SESSION_PHASE.RESTING;
  const session = data.session || null;
  const location = data.currentLocation || null;
  const controls = data.publicationControls || {};

  return {
    phase,
    phaseLabel: SESSION_PHASE_LABEL[phase] || SESSION_PHASE_LABEL[SESSION_PHASE.RESTING],
    phaseTone: PHASE_TONE[phase] || PHASE_TONE[SESSION_PHASE.RESTING],
    isOpen: phase === SESSION_PHASE.OPEN || phase === SESSION_PHASE.PREPARING,
    remainingMs: Number(data.remainingMs) || 0,
    remainingText: formatRemaining(Number(data.remainingMs) || 0),
    sessionId: session ? String(session.sessionId) : '',
    sessionVersion: session ? Number(session.version) || 0 : 0,
    startedText: session ? formatMoment(session.startedAtMs, nowMs) : '',
    plannedEndText: session && session.plannedEndAtMs
      ? describeClock(session.plannedEndAtMs, nowMs) : '',
    location: location ? {
      locationName: location.locationName || '',
      locatedText: formatMoment(location.locatedAtMs, nowMs),
    } : null,
    hasLocation: Boolean(location),
    // 营业天数由服务端在开摊时写，这里不自行累计
    openDaysText: formatCount(Number(data.totalOpenDays) || 0, '天'),
    restriction: toRestriction({
      selfStopped: controls.selfStoppedAtMs != null,
      governancePaused: controls.governancePausedAtMs != null,
    }),
    eligibility: toEligibility(data.profileEligibility),
  };
}

module.exports = { toWorkbenchModel };

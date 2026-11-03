/**
 * 导航复核结果的展示口径（纯函数）。
 *
 * 服务端只回答两件事：READY（可以发起）或 CONFIRM_REQUIRED（准备收摊，需要本人确认）。
 * 这里只负责把结论翻译成弹层文案，不做任何资格推断。
 */
const { describeClock, formatRemaining } = require('../../utils/clock');

const NAV_DECISION = Object.freeze({
  READY: 'READY',
  CONFIRM_REQUIRED: 'CONFIRM_REQUIRED',
});

/**
 * D01「准备收摊」弹层文案。
 * 显示"今天/次日 HH:mm 收摊 + 约剩 X 分钟"——只给结论，不给坐标。
 */
function toConfirmSheet({ plannedEndAtMs, remainingMs }, nowMs) {
  const endAt = Number(plannedEndAtMs);
  const remain = Number(remainingMs);
  const endText = Number.isFinite(endAt) && endAt > 0 ? describeClock(endAt, nowMs) : '';
  const remainText = Number.isFinite(remain) ? formatRemaining(remain) : '';
  return {
    title: '摊主准备收摊',
    description: endText
      ? `预计 ${endText} 收摊${remainText ? `，约剩 ${remainText}` : ''}。继续前往前会再确认一次最新状态。`
      : '摊主准备收摊，继续前往前会再确认一次最新状态。',
    confirmText: '继续导航',
    cancelText: '暂不前往',
  };
}

/** 复核后仍不是 READY 时的统一说明：状态变了，必须重新取数，不能按旧页面继续。 */
function toStaleNavigationMessage(decision) {
  return decision === NAV_DECISION.CONFIRM_REQUIRED
    ? '摊主仍在准备收摊，请刷新后再试'
    : '营业状态已变化，请查看最新状态';
}

module.exports = {
  NAV_DECISION,
  toConfirmSheet,
  toStaleNavigationMessage,
};

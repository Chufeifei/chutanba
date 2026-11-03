/**
 * 导航复核与发起（C-02.5 / AC-18 的唯一实现处）。
 *
 * 需求要求"每次从小程序新发起导航，都必须在线复核最新状态"。
 * 因此这里不提供"直接拿详情坐标导航"的方法，也不缓存复核结论：
 * 页面每点一次导航就是一次新的 check + launch。
 *
 * 坐标只在 launchNavigation 的调用栈里短暂存在，交给 utils/navigation 后即丢弃，
 * 不进页面 data、不落 storage。
 */
const publicApi = require('../../api/public');
const { runWrite } = require('../submission');
const { openFromLaunch } = require('../../utils/navigation');
const { WRITE_OUTCOME } = require('../../utils/failure');
const {
  NAV_DECISION, toConfirmSheet, toStaleNavigationMessage,
} = require('./rules');

// 与后端 discovery/service/navigation.js 的操作类型一致，超时后按原键查询
const CHECK_OPERATION = 'PUBLIC_NAVIGATION_CHECK';
const LAUNCH_OPERATION = 'PUBLIC_NAVIGATION_LAUNCH';

/**
 * 第一步：在线复核。
 * @param {object} params
 * @param {string} params.vendorId
 * @param {{sessionId: string, locationVersionId: string}} params.expected 展示时的轮次与位置版本
 * @param {boolean} [params.confirmPrepared] 准备收摊二次确认时必须为 true，且使用新意图
 * @returns {Promise<{outcome: string, decision?: string, navigationCheckId?: string,
 *   observationId?: string, plannedEndAtMs?: number, remainingMs?: number, message?: string}>}
 */
async function checkNavigation({ vendorId, expected, confirmPrepared = false }) {
  const result = await runWrite({
    operationType: CHECK_OPERATION,
    execute: ({ idempotencyKey }) => publicApi.checkNavigation(
      String(vendorId),
      {
        expectedSessionId: expected && expected.sessionId,
        expectedLocationVersionId: expected && expected.locationVersionId,
        confirmPrepared,
      },
      { idempotencyKey },
    ),
  });
  if (result.outcome !== WRITE_OUTCOME.SUCCEEDED) return result;

  const data = result.data || {};
  return {
    outcome: WRITE_OUTCOME.SUCCEEDED,
    decision: data.decision,
    navigationCheckId: String(data.navigationCheckId || ''),
    observationId: data.observationId ? String(data.observationId) : '',
    plannedEndAtMs: Number(data.plannedEndAtMs) || 0,
    remainingMs: Number(data.remainingMs) || 0,
  };
}

/**
 * 第二步：用复核结论换坐标并打开微信导航。
 * 复核结论已过期、轮次或位置已变时服务端不再返回坐标，此时必须终止本次导航，
 * 不能回退到详情或缓存里的旧坐标。
 * @param {string} navigationCheckId
 * @returns {Promise<{outcome: string, opened?: boolean, message?: string}>}
 */
async function launchNavigation(navigationCheckId) {
  const result = await runWrite({
    operationType: LAUNCH_OPERATION,
    execute: ({ idempotencyKey }) => publicApi.launchNavigation(
      { navigationCheckId },
      { idempotencyKey },
    ),
  });
  if (result.outcome !== WRITE_OUTCOME.SUCCEEDED) return result;

  // openFromLaunch 会在没有有效坐标时抛错，页面据此显示"已取消本次导航"
  await openFromLaunch(result.data);
  return { outcome: WRITE_OUTCOME.SUCCEEDED, opened: true, data: result.data };
}

/** READY 才允许发起；其余结论一律停在这里，由页面提示刷新。 */
function canLaunch(decision) {
  return decision === NAV_DECISION.READY;
}

/**
 * 一次完整的用户导航意图（页面只调用这一个方法）。
 *
 * 把"复核 → 是否需要确认 → 再复核 → 发起"的判定放在 service，
 * 页面只决定怎么展示 NEED_CONFIRM 的弹层与 BLOCKED 的提示。
 * @param {object} params
 * @param {string} params.vendorId
 * @param {{sessionId: string, locationVersionId: string}} params.expected
 * @param {boolean} [params.confirmPrepared] 点"继续导航"后必须传 true（新意图）
 * @returns {Promise<{kind: 'LAUNCHED'|'NEED_CONFIRM'|'BLOCKED', sheet?: object,
 *   message?: string, reload?: boolean}>}
 */
async function beginNavigation({ vendorId, expected, confirmPrepared = false }) {
  const check = await checkNavigation({ vendorId, expected, confirmPrepared });
  if (check.outcome !== WRITE_OUTCOME.SUCCEEDED) {
    return { kind: 'BLOCKED', message: check.message || '暂时无法确认最新位置' };
  }
  if (check.decision === NAV_DECISION.CONFIRM_REQUIRED) {
    return { kind: 'NEED_CONFIRM', sheet: toConfirmSheet(check, Date.now()) };
  }
  if (!canLaunch(check.decision)) {
    return {
      kind: 'BLOCKED',
      message: toStaleNavigationMessage(check.decision),
      // 状态已变化：页面必须重新取数，不能按旧页面继续
      reload: true,
    };
  }
  try {
    const launched = await launchNavigation(check.navigationCheckId);
    if (launched.outcome !== WRITE_OUTCOME.SUCCEEDED) {
      // 发起超时或失败都不能当成"已打开导航"：没有坐标就没有导航
      return {
        kind: 'BLOCKED',
        message: launched.outcome === WRITE_OUTCOME.UNKNOWN
          ? '导航发起结果待确认，请重新确认最新状态'
          : (launched.message || '未能打开导航'),
        reload: launched.outcome === WRITE_OUTCOME.UNKNOWN,
      };
    }
    return { kind: 'LAUNCHED' };
  } catch (error) {
    return { kind: 'BLOCKED', message: (error && error.message) || '未能打开导航' };
  }
}

module.exports = {
  CHECK_OPERATION,
  LAUNCH_OPERATION,
  NAV_DECISION,
  checkNavigation,
  launchNavigation,
  beginNavigation,
  canLaunch,
  toConfirmSheet,
  toStaleNavigationMessage,
};

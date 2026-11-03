/**
 * 定位开摊（P09 的第一个写动作）。
 *
 * 顺序是硬约束，不能调换：
 *   记尝试 → 签发定位上下文 → 取定位 → 提交开摊。
 * 服务端要求定位时刻不早于上下文签发时刻（locatedAtMs >= issuedAtMs），
 * 先定位后签上下文会被判 LOCATION_INVALID。
 *
 * 每一步都是独立写命令，各自持有幂等键：任何一步失败都不会重复产生营业事实。
 */
const sessionApi = require('../../api/vendor-session');
const { runWrite, abandonPending } = require('../submission');
const { WRITE_OUTCOME } = require('../../utils/failure');
const support = require('./write-support');

/**
 * @param {object} params
 * @param {number} params.plannedEndAtMs 本人确认的截止时刻
 * @param {number} params.expectedVendorVersion 摊主版本基准
 * @param {string} [params.locationName] 位置名称，缺省用「我的摊位位置」
 */
async function openSession({ plannedEndAtMs, expectedVendorVersion, locationName }) {
  const pending = support.pendingOutcome(
    support.OPERATION.OPEN,
    '上一次开摊结果待确认，请先查看最新结果',
  );
  if (pending) return pending;

  const attempt = await runWrite({
    operationType: support.OPERATION.ATTEMPT,
    execute: ({ idempotencyKey }) => sessionApi.createOpenAttempt(
      { plannedEndAtMs, expectedVendorVersion },
      { idempotencyKey },
    ),
  });
  if (attempt.outcome !== WRITE_OUTCOME.SUCCEEDED) {
    // 尝试本身不产生营业事实，失败后丢弃原键，避免下一次换截止时间时撞同键不同体
    abandonPending({ operationType: support.OPERATION.ATTEMPT });
    return { ...attempt, stage: 'attempt' };
  }
  const attemptId = attempt.data && attempt.data.attemptId;
  if (!attemptId) {
    abandonPending({ operationType: support.OPERATION.ATTEMPT });
    return { outcome: WRITE_OUTCOME.FAILED, stage: 'attempt', message: '未能取得开摊尝试编号，请重试' };
  }

  const context = await support.issueContext(support.OPERATION.CONTEXT_OPEN, 'OPEN', attemptId);
  if (context.outcome !== WRITE_OUTCOME.SUCCEEDED) {
    await support.finishAttempt(attemptId, 'CANCELLED');
    return { ...context, stage: 'context' };
  }
  const token = context.data && context.data.locationContextToken;
  if (!token) {
    await support.finishAttempt(attemptId, 'CANCELLED');
    return { outcome: WRITE_OUTCOME.FAILED, stage: 'context', message: '未能取得定位凭据，请重试' };
  }

  let current;
  try {
    current = await support.takeLocation(locationName);
  } catch (error) {
    const failure = support.locationFailureOf(error);
    await support.finishAttempt(attemptId, support.attemptOutcomeOf(failure));
    return {
      outcome: WRITE_OUTCOME.FAILED,
      stage: 'location',
      message: (error && error.message) || '暂时无法取得位置',
      locationFailure: failure,
    };
  }

  const opened = await runWrite({
    operationType: support.OPERATION.OPEN,
    execute: ({ idempotencyKey }) => sessionApi.openSession({
      attemptId: String(attemptId),
      plannedEndAtMs,
      locationContextToken: token,
      location: current,
      expectedVendorVersion,
    }, { idempotencyKey }),
  });
  return { ...opened, stage: 'open' };
}

module.exports = { openSession };

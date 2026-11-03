/**
 * 摊主工作台的写动作入口（P09：开摊、刷新位置、手动收摊）。
 *
 * 开摊流程单独放在 open-session.js，因为它有四步顺序约束；
 * 刷新与收摊在这里，三者共用 write-support.js 的底座。
 *
 * 结果未知的写命令不能换键重发：同一操作类型保留原键，页面改为按原键查询。
 */
const sessionApi = require('../../api/vendor-session');
const { runWrite, queryOutcome } = require('../submission');
const { WRITE_OUTCOME } = require('../../utils/failure');
const support = require('./write-support');
const { openSession } = require('./open-session');

/** 营业中刷新位置：失败保留上次成功位置，服务端不会替换。 */
async function refreshLocation({ sessionId, expectedSessionVersion, locationName }) {
  const pending = support.pendingOutcome(
    support.OPERATION.REFRESH,
    '上一次刷新结果待确认，请先查看最新结果',
  );
  if (pending) return pending;

  const context = await support.issueContext(support.OPERATION.CONTEXT_REFRESH, 'REFRESH', sessionId);
  if (context.outcome !== WRITE_OUTCOME.SUCCEEDED) return { ...context, stage: 'context' };
  const token = context.data && context.data.locationContextToken;
  if (!token) {
    return { outcome: WRITE_OUTCOME.FAILED, stage: 'context', message: '未能取得定位凭据，请重试' };
  }

  let current;
  try {
    current = await support.takeLocation(locationName);
  } catch (error) {
    return {
      outcome: WRITE_OUTCOME.FAILED,
      stage: 'location',
      message: (error && error.message) || '暂时无法取得位置',
      locationFailure: support.locationFailureOf(error),
    };
  }

  const refreshed = await runWrite({
    operationType: support.OPERATION.REFRESH,
    execute: ({ idempotencyKey }) => sessionApi.addSessionLocation(
      String(sessionId),
      { locationContextToken: token, location: current, expectedSessionVersion },
      { idempotencyKey },
    ),
  });
  return { ...refreshed, stage: 'refresh' };
}

/** 手动收摊。到期、本人停止、治理暂停走各自的命令，不在这里合并。 */
async function closeSession({ sessionId, expectedSessionVersion }) {
  const pending = support.pendingOutcome(
    support.OPERATION.CLOSE,
    '上一次收摊结果待确认，请先查看最新结果',
  );
  if (pending) return pending;
  const closed = await runWrite({
    operationType: support.OPERATION.CLOSE,
    execute: ({ idempotencyKey }) => sessionApi.closeSession(
      String(sessionId),
      { expectedSessionVersion },
      { idempotencyKey },
    ),
  });
  return { ...closed, stage: 'close' };
}

/** 按原操作键查询上一次写操作的结果。 */
function queryOutcomeOf(operationType) {
  return queryOutcome({ operationType });
}

module.exports = {
  OPERATION: support.OPERATION,
  DEFAULT_LOCATION_NAME: support.DEFAULT_LOCATION_NAME,
  openSession,
  refreshLocation,
  closeSession,
  queryOutcomeOf,
};

/**
 * 写命令的唯一出口（三个唯一出口之二）。
 *
 * 解决的问题：网络超时时，页面无法区分"操作没发生"和"操作已成立但响应丢了"。
 * 如果按失败处理并让用户再点一次，就会产生第二次真实业务结果
 * （重复开摊、重复治理、重复审核 —— 对应 AC-08、AC-11 和 R-03）。
 *
 * 因此这里的契约是：
 * 1. 一次用户意图生成一个操作键，并落盘；
 * 2. 超时 / 网络异常 → 返回 UNKNOWN，保留键，等调用方查询；
 * 3. 查询用同一个键，拿到 SUCCEEDED 再清键；
 * 4. 只有确定不成立（校验失败、冲突、明确失败）才清键，允许用户重新发起。
 */
const { WRITE_OUTCOME, toWriteOutcome } = require('../../utils/failure');
const actionKey = require('../../utils/action-key');
const { queryOperation } = require('../../api/me');

/**
 * @param {object} params
 * @param {string} params.operationType  操作类型，须与查询接口一致，如 'session-open'
 * @param {function} params.execute      接收 { idempotencyKey } 并调用 api 的函数
 * @returns {Promise<{outcome:string, data?:*, message?:string, fields?:Array, idempotencyKey?:string}>}
 */
async function runWrite({ operationType, execute }) {
  if (!operationType || typeof execute !== 'function') {
    throw new TypeError('runWrite 需要 operationType 与 execute');
  }

  const { key, reused } = actionKey.acquireKey(operationType);

  try {
    const response = await execute({ idempotencyKey: key });
    actionKey.clearKey(operationType);
    return {
      outcome: WRITE_OUTCOME.SUCCEEDED,
      data: response && response.data,
      requestId: response && response.requestId,
      // reused 为真说明本次是原意图的重试，服务端可能回放了上次结果
      replayed: reused,
    };
  } catch (error) {
    const failed = toWriteOutcome(error);
    const payload = {
      ...failed,
      operationType,
      idempotencyKey: key,
    };

    // 结果未知：保留键，调用方必须走 queryOutcome 确认，不能换键重发
    if (failed.outcome === WRITE_OUTCOME.UNKNOWN) {
      return payload;
    }

    // 可重试的明确失败：保留键，用户重试时服务端按同键去重
    if (failed.outcome === WRITE_OUTCOME.FAILED && failed.retryable) {
      return payload;
    }

    actionKey.clearKey(operationType);
    return payload;
  }
}

const QUERY_OUTCOME = Object.freeze({
  NO_PENDING: 'no-pending',
  PROCESSING: 'processing',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
});

/**
 * 按原键查询上一次写操作的结果。
 * @param {object} params
 * @param {string} params.operationType 与 runWrite 相同的操作类型
 */
async function queryOutcome({ operationType }) {
  const key = actionKey.peekKey(operationType);
  if (!key) return { outcome: QUERY_OUTCOME.NO_PENDING, operationType };

  const response = await queryOperation(operationType, key);
  const data = (response && response.data) || {};
  const status = data.status;

  if (status === 'SUCCEEDED') {
    actionKey.clearKey(operationType);
    return { outcome: QUERY_OUTCOME.SUCCEEDED, operationType, data, idempotencyKey: key };
  }
  if (status === 'FAILED') {
    actionKey.clearKey(operationType);
    return { outcome: QUERY_OUTCOME.FAILED, operationType, data, idempotencyKey: key };
  }
  // PROCESSING 或状态未知：继续等，键必须保留
  return { outcome: QUERY_OUTCOME.PROCESSING, operationType, data, idempotencyKey: key };
}

/** 用户主动放弃本次意图时才清键（例如离开页面并确认放弃）。 */
function abandonPending({ operationType }) {
  actionKey.clearKey(operationType);
}

module.exports = { WRITE_OUTCOME, QUERY_OUTCOME, runWrite, queryOutcome, abandonPending };

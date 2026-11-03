/**
 * 公开写用例的幂等外壳：统一复用 W2 的 operation 底座。
 * 首次执行返回 resultRef，由调用方 reload 投影；回放直接取首次结果；
 * 在途返回 PROCESSING（路由转 202）。
 */
const { BIZ_CODES, DomainError } = require('../../../domain/errors');
const operation = require('../../operation');

async function runIdempotent({
  actorScope, operationType, key, request, execute, reload,
}) {
  const outcome = await operation.executeIdempotent({
    actorScope, operationType, key, request, execute, reload,
  });
  if (outcome.status === 'PROCESSING') return { status: 'PROCESSING' };
  if (outcome.status === 'FAILED') {
    throw new DomainError(BIZ_CODES[outcome.bizCode] ? outcome.bizCode : 'STATE_CONFLICT');
  }
  return outcome.replayed ? outcome.result : reload(outcome.resultRef);
}

module.exports = { runIdempotent };

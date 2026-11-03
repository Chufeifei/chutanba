/**
 * 影响复核的共用守卫：幂等回放与版本冲突的统一表达。
 * 申请与管理决定共用同一套语义，避免两条链路给出不同的冲突口径。
 */
const { DomainError } = require('../../../../domain/errors');

/** 幂等回放：PROCESSING 原样返回，FAILED 按原错误码抛出，成功回放原结果。 */
function unwrap(outcome, payload) {
  if (outcome.status === 'PROCESSING') return outcome;
  if (outcome.status === 'FAILED') throw new DomainError(outcome.bizCode);
  return { ...(outcome.replayed ? outcome.result : payload), replayed: outcome.replayed };
}

/** 版本冲突：告诉客户端当前版本，客户端刷新后重试。 */
function conflict(resource, currentVersion) {
  return new DomainError('STATE_CONFLICT', '状态已更新，请刷新后重试', { resource, currentVersion });
}

module.exports = { unwrap, conflict };

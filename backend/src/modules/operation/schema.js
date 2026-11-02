const { DomainError } = require('../../domain/errors');

const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

function invalid(field, reason = 'INVALID') {
  return new DomainError('VALIDATION_FAILED', '写操作参数不合法', { fields: [{ field, reason }] });
}

/** 路由取头后 service 再校验一次，防止脚本或内部调用绕过。 */
function assertIdempotencyKey(key) {
  if (key === undefined || key === null || key === '') throw invalid('Idempotency-Key', 'REQUIRED');
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) throw invalid('Idempotency-Key');
  return key;
}

function assertOperationIdentity(actorScope, operationType) {
  if (typeof actorScope !== 'string' || !actorScope.trim() || actorScope.length > 128) {
    throw invalid('actorScope');
  }
  if (typeof operationType !== 'string' || !operationType.trim() || operationType.length > 64) {
    throw invalid('operationType');
  }
  return { actorScope, operationType };
}

module.exports = { assertIdempotencyKey, assertOperationIdentity };

const { DomainError } = require('../../domain/errors');
const repository = require('./repository');

function invalid(field) {
  return new DomainError('VALIDATION_FAILED', '审计字段不合法', { fields: [field] });
}

function text(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw invalid(field);
  return value;
}

function optionalText(value, field, maxLength) {
  if (value === null || value === undefined) return null;
  return text(value, field, maxLength);
}

function identifier(value, field, optional) {
  if (value === null || value === undefined) {
    if (optional) return null;
    throw invalid(field);
  }
  if (!Number.isInteger(value) || value <= 0) throw invalid(field);
  return value;
}

function timestamp(value, field) {
  if (!Number.isInteger(value) || value < 0) throw invalid(field);
  return value;
}

/**
 * 审计失败必须抛错让业务事务回滚；这里只校验形状与长度，不读库、不忽略异常。
 */
function assertEvent(event) {
  return {
    actionCode: text(event.actionCode, 'actionCode', 64),
    actorAccountId: identifier(event.actorAccountId, 'actorAccountId', true),
    targetType: text(event.targetType, 'targetType', 32),
    targetId: identifier(event.targetId, 'targetId', false),
    occurredAtMs: timestamp(event.occurredAtMs, 'occurredAtMs'),
    resultCode: text(event.resultCode, 'resultCode', 64),
    reasonSummary: optionalText(event.reasonSummary, 'reasonSummary', 500),
    operationId: identifier(event.operationId, 'operationId', true),
    retentionClass: text(event.retentionClass, 'retentionClass', 24),
  };
}

async function record(connection, event) {
  return repository.insertEvent(connection, assertEvent(event));
}

module.exports = { record };

/**
 * 公开控制入参：两类限制各自带独立版本号，客户端必须回传预期值。
 * 需求出处：prd R6/R8 与 doc/MVP/一期技术设计.md §7.3/§7.4。
 */
const { DomainError } = require('../../domain/errors');

const MAX_REASON_LENGTH = 200;

function invalid(field, reason = 'INVALID') {
  return new DomainError('VALIDATION_FAILED', '请求参数不合法', { fields: [{ field, reason }] });
}

function assertAllowedKeys(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('body');
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw invalid(key);
  }
}

function assertVersion(value, field) {
  if (!Number.isInteger(value) || value < 1) throw invalid(field);
  return value;
}

/** 本人停止／恢复：只接受本人版本，治理列只能由管理动作改动。 */
function normalizeSelfMutation(body) {
  assertAllowedKeys(body, ['expectedSelfVersion']);
  return { expectedSelfVersion: assertVersion(body.expectedSelfVersion, 'expectedSelfVersion') };
}

/** 治理暂停／解除：W4 只在服务层校验，管理权限入口留给 W7。 */
function normalizeGovernanceMutation(body) {
  assertAllowedKeys(body, ['expectedGovernanceVersion', 'reason']);
  const reason = body.reason === undefined || body.reason === null ? null : String(body.reason).trim();
  if (reason !== null && (reason.length < 1 || reason.length > MAX_REASON_LENGTH)) throw invalid('reason');
  return {
    expectedGovernanceVersion: assertVersion(body.expectedGovernanceVersion, 'expectedGovernanceVersion'),
    reason,
  };
}

module.exports = { normalizeSelfMutation, normalizeGovernanceMutation, invalid };

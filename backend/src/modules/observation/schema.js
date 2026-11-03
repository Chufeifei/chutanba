/**
 * 观察相关入参校验（契约 §5.3）。
 * 白名单式：出现契约未定义字段一律 VALIDATION_FAILED；游标为服务端生成的不透明串。
 */
const { DomainError } = require('../../domain/errors');

const ID_PATTERN = /^\d{1,20}$/;
const CURSOR_PATTERN = /^\d{1,16}_\d{1,20}$/;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_TOKEN_LENGTH = 400;

function invalid(field, reason = 'INVALID') {
  return new DomainError('VALIDATION_FAILED', '请求参数不合法', { fields: [{ field, reason }] });
}

function assertObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('body');
}

function assertAllowedKeys(input, allowed) {
  assertObject(input);
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw invalid(key, 'UNKNOWN_FIELD');
  }
}

function assertId(value, field) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw invalid(field);
  if (BigInt(value) <= 0n) throw invalid(field);
  return BigInt(value).toString();
}

function parseCursor(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !CURSOR_PATTERN.test(value)) throw invalid('cursor');
  const [eventAtMs, id] = value.split('_');
  return { eventAtMs: Number(eventAtMs), observationId: id };
}

function parseLimit(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) throw invalid('limit');
  return parsed;
}

/** 领取只需令牌；令牌内容不解析，按摘要查库，避免暴露 observationId。 */
function parseClaimInput(body) {
  assertAllowedKeys(body, ['claimToken']);
  const token = body.claimToken;
  if (typeof token !== 'string' || token.length < 1 || token.length > MAX_TOKEN_LENGTH) {
    throw invalid('claimToken');
  }
  return { claimToken: token };
}

function parseCandidateQuery(query) {
  const input = query === undefined || query === null ? {} : query;
  assertAllowedKeys(input, ['cursor', 'limit']);
  return { cursor: parseCursor(input.cursor), limit: parseLimit(input.limit) };
}

module.exports = {
  MAX_LIMIT,
  DEFAULT_LIMIT,
  assertId,
  parseCursor,
  parseLimit,
  parseClaimInput,
  parseCandidateQuery,
};

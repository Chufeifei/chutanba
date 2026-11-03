/**
 * 清除入参校验：白名单式，未知字段一律 VALIDATION_FAILED。
 * 范围枚举与契约 §5.3 一致：ACCOUNT_DATA／VENDOR_DATA／ALL。
 */
const { DomainError } = require('../../domain/errors');

const SCOPES = Object.freeze(['ACCOUNT_DATA', 'VENDOR_DATA', 'ALL']);

function invalid(field, reason = 'INVALID') {
  return new DomainError('VALIDATION_FAILED', '请求参数不合法', {
    fields: [{ field, reason }],
  });
}

function assertKnownFields(input, allowed) {
  for (const key of Object.keys(input || {})) {
    if (!allowed.includes(key)) throw invalid(key, 'UNKNOWN_FIELD');
  }
}

function parseScopeValue(value) {
  const scope = String(value === undefined || value === null ? '' : value);
  if (!SCOPES.includes(scope)) throw invalid('scope', 'OUT_OF_RANGE');
  return scope;
}

/** 预览只接受 scope 一个查询参数。 */
function parseScopeQuery(query) {
  const input = query || {};
  assertKnownFields(input, ['scope']);
  if (input.scope === undefined || input.scope === null || input.scope === '') {
    throw invalid('scope', 'REQUIRED');
  }
  return parseScopeValue(input.scope);
}

/** 清除请求：范围与账号预期版本。 */
function parseSubmitInput(body) {
  assertKnownFields(body, ['scope', 'expectedAccountVersion']);
  if (!Number.isSafeInteger(body.expectedAccountVersion) || body.expectedAccountVersion < 0) {
    throw invalid('expectedAccountVersion', 'OUT_OF_RANGE');
  }
  return {
    scope: parseScopeValue(body.scope),
    expectedAccountVersion: body.expectedAccountVersion,
  };
}

/** 列表游标与页长：游标不透明但可校验。 */
function parseListQuery(query) {
  const input = query || {};
  assertKnownFields(input, ['cursor', 'limit']);
  const rawCursor = input.cursor === undefined || input.cursor === null || input.cursor === ''
    ? null : String(input.cursor);
  const limit = input.limit === undefined || input.limit === null || input.limit === ''
    ? 20 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid('limit', 'OUT_OF_RANGE');
  let cursor = null;
  if (rawCursor !== null) {
    if (!/^\d{1,20}_\d{1,20}$/.test(rawCursor)) throw invalid('cursor');
    cursor = {
      acceptedAtMs: Number(rawCursor.split('_')[0]),
      requestId: rawCursor.split('_')[1],
    };
  }
  return { cursor, limit };
}

module.exports = { SCOPES, parseScopeQuery, parseSubmitInput, parseListQuery };

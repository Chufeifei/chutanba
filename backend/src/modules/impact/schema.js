/**
 * 影响复核入参校验：白名单式，未知字段一律 VALIDATION_FAILED。
 * 长度与枚举口径与契约 §5.3／§5.4 一致；错误只列字段名，不回显取值。
 */
const { DomainError } = require('../../domain/errors');

const REVIEW_DECISIONS = Object.freeze(['UPHELD', 'REVOKED']);
const REVIEW_STATUSES = Object.freeze(['PENDING', 'UPHELD', 'REVOKED']);
const STATEMENT_MAX = 1000;
const REASON_MAX = 500;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

function invalid(field, reason = 'INVALID') {
  return new DomainError('VALIDATION_FAILED', '请求参数不合法', {
    fields: [{ field, reason }],
  });
}

function assertKnownFields(body, allowed) {
  for (const key of Object.keys(body || {})) {
    if (!allowed.includes(key)) throw invalid(key, 'UNKNOWN_FIELD');
  }
}

function assertId(value, field) {
  const text = String(value === undefined || value === null ? '' : value);
  if (!/^\d{1,20}$/.test(text)) throw invalid(field);
  const id = Number(text);
  if (!Number.isSafeInteger(id) || id <= 0) throw invalid(field);
  return id;
}

function assertVersion(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(field, 'OUT_OF_RANGE');
  return value;
}

function assertText(value, field, maxLength) {
  if (typeof value !== 'string') throw invalid(field);
  const text = value.trim();
  if (!text || text.length > maxLength || CONTROL_CHARACTERS.test(text)) throw invalid(field);
  return text;
}

/** 本人复核申请：影响记录、理由与预期影响版本。 */
function parseSubmitInput(body) {
  assertKnownFields(body, ['impactRecordId', 'reason', 'expectedImpactVersion']);
  return {
    impactRecordId: assertId(body.impactRecordId, 'impactRecordId'),
    reason: assertText(body.reason, 'reason', STATEMENT_MAX),
    expectedImpactVersion: assertVersion(body.expectedImpactVersion, 'expectedImpactVersion'),
  };
}

/** 管理复核决定：结论、理由与预期任务版本。 */
function parseDecision(body) {
  assertKnownFields(body, ['decision', 'reason', 'expectedTaskVersion']);
  const decision = String(body.decision || '');
  if (!REVIEW_DECISIONS.includes(decision)) throw invalid('decision', 'OUT_OF_RANGE');
  return {
    decision,
    reason: assertText(body.reason, 'reason', REASON_MAX),
    expectedTaskVersion: assertVersion(body.expectedTaskVersion, 'expectedTaskVersion'),
  };
}

/** 列表游标与页长：游标不透明但可校验，格式异常按入参错误处理。 */
function parseListQuery(query) {
  const input = query || {};
  for (const key of Object.keys(input)) {
    if (key !== 'cursor' && key !== 'limit' && key !== 'status') {
      throw invalid(key, 'UNKNOWN_FIELD');
    }
  }
  const rawCursor = input.cursor === undefined || input.cursor === null || input.cursor === ''
    ? null : String(input.cursor);
  const limit = input.limit === undefined || input.limit === null || input.limit === ''
    ? 20 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid('limit', 'OUT_OF_RANGE');
  let cursor = null;
  if (rawCursor !== null) {
    if (!/^\d{1,20}_\d{1,20}$/.test(rawCursor)) throw invalid('cursor');
    cursor = {
      createdAtMs: Number(rawCursor.split('_')[0]),
      reviewId: rawCursor.split('_')[1],
    };
  }
  let status = null;
  if (input.status !== undefined && input.status !== null && input.status !== '') {
    status = String(input.status);
    if (!REVIEW_STATUSES.includes(status)) throw invalid('status', 'OUT_OF_RANGE');
  }
  return { cursor, limit, status };
}

module.exports = { parseSubmitInput, parseDecision, parseListQuery, REVIEW_DECISIONS };

const { DomainError } = require('../../domain/errors');
const { isCategoryCode } = require('./categories');

// G-01（2026-11-02 确认）：trim 后按 Unicode 码点计数，拒绝纯空白、控制字符与 HTML 标记字符。
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;
const MARKUP_CHARACTERS = /[<>]/;
const SUBMISSION_FIELDS = Object.freeze([
  'vendorName', 'categoryCode', 'regularItemsText', 'priceDescription',
  'announcement', 'expectedVendorVersion',
]);
const DECISION_FIELDS = Object.freeze(['decision', 'reason', 'expectedTaskVersion']);
const REVIEW_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'INVALIDATED']);
const QUERY_FIELDS = Object.freeze(['status', 'cursor', 'limit']);
const DECISIONS = Object.freeze(['APPROVE', 'REJECT']);

function invalid(fields) {
  return new DomainError('VALIDATION_FAILED', '资料字段不合法', { fields });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 白名单校验：契约未定义的字段必须显式失败，不能静默丢弃。 */
function assertWhitelist(body, allowed, errors) {
  if (!isPlainObject(body)) {
    errors.push({ field: 'body', reason: 'INVALID_TYPE' });
    return false;
  }
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) errors.push({ field: key, reason: 'UNKNOWN_FIELD' });
  }
  return true;
}

function textField(value, field, maxLength, errors) {
  if (typeof value !== 'string') {
    errors.push({ field, reason: 'INVALID_TYPE' });
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    errors.push({ field, reason: 'EMPTY' });
    return null;
  }
  if (Array.from(trimmed).length > maxLength) {
    errors.push({ field, reason: 'TOO_LONG' });
    return null;
  }
  if (CONTROL_CHARACTERS.test(trimmed)) {
    errors.push({ field, reason: 'CONTROL_CHARACTER' });
    return null;
  }
  if (MARKUP_CHARACTERS.test(trimmed)) {
    errors.push({ field, reason: 'INVALID_CHARACTER' });
    return null;
  }
  return trimmed;
}

/** expected*Version 是非负安全整数；缺失、布尔、字符串都不接受。 */
function versionField(value, field, errors) {
  if (!Number.isSafeInteger(value) || value < 0) {
    errors.push({ field, reason: 'OUT_OF_RANGE' });
    return null;
  }
  return value;
}

function categoryField(value, errors) {
  const code = typeof value === 'string' ? value.trim() : null;
  if (!isCategoryCode(code)) {
    errors.push({ field: 'categoryCode', reason: 'UNKNOWN_CATEGORY' });
    return null;
  }
  return code;
}

function normalizeSubmission(body) {
  const errors = [];
  if (!assertWhitelist(body, SUBMISSION_FIELDS, errors)) throw invalid(errors);
  const vendorName = textField(body.vendorName, 'vendorName', 40, errors);
  const categoryCode = categoryField(body.categoryCode, errors);
  const regularItemsText = textField(body.regularItemsText, 'regularItemsText', 200, errors);
  const priceDescription = textField(body.priceDescription, 'priceDescription', 120, errors);
  const announcement = textField(body.announcement, 'announcement', 300, errors);
  const expectedVendorVersion = versionField(body.expectedVendorVersion, 'expectedVendorVersion', errors);
  if (errors.length) throw invalid(errors);
  return {
    vendorName, categoryCode, regularItemsText, priceDescription, announcement, expectedVendorVersion,
  };
}

function decisionReason(body, errors) {
  if (body.reason === undefined || body.reason === null) {
    if (body.decision === 'REJECT') errors.push({ field: 'reason', reason: 'REQUIRED' });
    return null;
  }
  if (typeof body.reason !== 'string') {
    errors.push({ field: 'reason', reason: 'INVALID_TYPE' });
    return null;
  }
  const trimmed = body.reason.trim();
  if (!trimmed) {
    if (body.decision === 'REJECT') errors.push({ field: 'reason', reason: 'REQUIRED' });
    return null;
  }
  if (Array.from(trimmed).length > 500) errors.push({ field: 'reason', reason: 'TOO_LONG' });
  else if (CONTROL_CHARACTERS.test(trimmed)) errors.push({ field: 'reason', reason: 'CONTROL_CHARACTER' });
  else if (MARKUP_CHARACTERS.test(trimmed)) errors.push({ field: 'reason', reason: 'INVALID_CHARACTER' });
  else return trimmed;
  return null;
}

function normalizeDecision(body) {
  const errors = [];
  if (!assertWhitelist(body, DECISION_FIELDS, errors)) throw invalid(errors);
  const decision = body.decision;
  if (!DECISIONS.includes(decision)) errors.push({ field: 'decision', reason: 'ENUM' });
  const reason = decisionReason(body, errors);
  const expectedTaskVersion = versionField(body.expectedTaskVersion, 'expectedTaskVersion', errors);
  if (errors.length) throw invalid(errors);
  return { decision, reason, expectedTaskVersion };
}

function assertSubmissionId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) throw invalid([{ field: 'id', reason: 'INVALID' }]);
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw invalid([{ field: 'id', reason: 'OUT_OF_RANGE' }]);
  return id;
}

function decodeCursor(value, errors) {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const valid = parsed && parsed.v === 1 && REVIEW_STATUSES.includes(parsed.s) &&
      Number.isSafeInteger(parsed.t) && parsed.t >= 0 && Number.isSafeInteger(parsed.i) && parsed.i > 0;
    if (!valid) throw new Error('invalid cursor');
    return { status: parsed.s, submittedAtMs: parsed.t, id: parsed.i };
  } catch (error) {
    errors.push({ field: 'cursor', reason: 'INVALID' });
    return null;
  }
}

function encodeReviewCursor({ status, submittedAtMs, id }) {
  return Buffer.from(JSON.stringify({ v: 1, s: status, t: submittedAtMs, i: id }), 'utf8').toString('base64url');
}

function queryLimit(value, errors) {
  if (value === undefined) return 20;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    errors.push({ field: 'limit', reason: 'OUT_OF_RANGE' });
    return null;
  }
  const limit = Number(value);
  if (limit > 100) {
    errors.push({ field: 'limit', reason: 'OUT_OF_RANGE' });
    return null;
  }
  return limit;
}

function normalizeReviewQuery(query) {
  const input = isPlainObject(query) ? query : {};
  const errors = [];
  for (const key of Object.keys(input)) {
    if (!QUERY_FIELDS.includes(key)) errors.push({ field: key, reason: 'UNKNOWN_FIELD' });
  }
  const status = input.status === undefined ? 'PENDING' : input.status;
  if (!REVIEW_STATUSES.includes(status)) errors.push({ field: 'status', reason: 'ENUM' });
  const limit = queryLimit(input.limit, errors);
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor, errors);
  if (cursor && cursor.status !== status) errors.push({ field: 'cursor', reason: 'STATUS_MISMATCH' });
  if (errors.length) throw invalid(errors);
  return { status, limit, cursor };
}

module.exports = {
  normalizeSubmission, normalizeDecision, normalizeReviewQuery,
  encodeReviewCursor, assertSubmissionId,
};

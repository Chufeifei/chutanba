/**
 * 营业域入参归一化：白名单字段、ID 转十进制字符串、游标编解码。
 * 路由不做业务判断，所有形状校验集中在这里；业务规则（资格、窗口）在 service。
 */
const { DomainError } = require('../../domain/errors');

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ID_PATTERN = /^\d{1,20}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;
const ATTEMPT_OUTCOMES = ['LOCATION_FAILED', 'TIME_FAILED', 'CANCELLED'];
const OPEN_DAY_LIMIT_DEFAULT = 20;
const OPEN_DAY_LIMIT_MAX = 100;

function invalid(field, reason = 'INVALID') {
  return new DomainError('VALIDATION_FAILED', '请求参数不合法', { fields: [{ field, reason }] });
}

function assertAllowedKeys(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('body');
  const keys = Object.keys(input);
  if (keys.length !== allowed.length) throw invalid(keys.filter((key) => !allowed.includes(key))[0] || 'body');
  for (const key of keys) {
    if (!allowed.includes(key)) throw invalid(key);
  }
}

function assertSafeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(field);
  return value;
}

/** BIGINT UNSIGNED 主键：先按 BigInt 解析再转字符串，避免 Number 精度丢失。 */
function assertPathId(value, field = 'id') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw invalid(field);
  const parsed = BigInt(value);
  if (parsed <= 0n) throw invalid(field);
  return parsed.toString();
}

function normalizeOpenAttempt(body) {
  assertAllowedKeys(body, ['plannedEndAtMs', 'expectedVendorVersion']);
  return {
    plannedEndAtMs: assertSafeInteger(body.plannedEndAtMs, 'plannedEndAtMs'),
    expectedVendorVersion: assertSafeInteger(body.expectedVendorVersion, 'expectedVendorVersion'),
  };
}

function normalizeAttemptFinish(body) {
  assertAllowedKeys(body, ['outcome']);
  if (!ATTEMPT_OUTCOMES.includes(body.outcome)) throw invalid('outcome');
  return { outcome: body.outcome };
}

const CONTEXT_PURPOSES = ['OPEN', 'REFRESH', 'FEEDBACK'];

function normalizeIssueContext(body) {
  assertAllowedKeys(body, ['purpose', 'targetId']);
  // 三种用途的目标不同：OPEN/REFRESH 是摊主自己的开摊尝试与轮次，FEEDBACK 是本人已领取的观察。
  // 目标归属由 service 按用途分别校验，这里只做枚举与形状。
  if (!CONTEXT_PURPOSES.includes(body.purpose)) throw invalid('purpose');
  return { purpose: body.purpose, targetId: assertPathId(body.targetId, 'targetId') };
}

function assertToken(value) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) throw invalid('locationContextToken');
  return value;
}

function assertLocationShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('location');
  return value;
}

function normalizeOpenSession(body) {
  assertAllowedKeys(body, [
    'attemptId', 'plannedEndAtMs', 'locationContextToken', 'location', 'expectedVendorVersion',
  ]);
  return {
    attemptId: assertPathId(body.attemptId, 'attemptId'),
    plannedEndAtMs: assertSafeInteger(body.plannedEndAtMs, 'plannedEndAtMs'),
    locationContextToken: assertToken(body.locationContextToken),
    location: assertLocationShape(body.location),
    expectedVendorVersion: assertSafeInteger(body.expectedVendorVersion, 'expectedVendorVersion'),
  };
}

function normalizeRefresh(body) {
  assertAllowedKeys(body, ['locationContextToken', 'location', 'expectedSessionVersion']);
  return {
    locationContextToken: assertToken(body.locationContextToken),
    location: assertLocationShape(body.location),
    expectedSessionVersion: assertSafeInteger(body.expectedSessionVersion, 'expectedSessionVersion'),
  };
}

function normalizeClose(body) {
  assertAllowedKeys(body, ['expectedSessionVersion']);
  return { expectedSessionVersion: assertSafeInteger(body.expectedSessionVersion, 'expectedSessionVersion') };
}

/** 本人停止／恢复公开：只带本人控制版本，版本非负整数（design §7.3）。 */
function normalizeSelfMutation(body) {
  assertAllowedKeys(body, ['expectedSelfVersion']);
  return { expectedSelfVersion: assertSafeInteger(body.expectedSelfVersion, 'expectedSelfVersion') };
}

function encodeCursor({ openDate, id }) {
  return Buffer.from(JSON.stringify({ d: openDate, i: String(id) }), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  let parsed = null;
  try {
    parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
  } catch (error) {
    throw invalid('cursor');
  }
  if (!parsed || typeof parsed.d !== 'string' || !DATE_KEY_PATTERN.test(parsed.d)) throw invalid('cursor');
  if (!ID_PATTERN.test(String(parsed.i))) throw invalid('cursor');
  return { openDate: parsed.d, id: String(parsed.i) };
}

function normalizeOpenDaysQuery(query = {}) {
  const rawLimit = query.limit === undefined || query.limit === '' ? OPEN_DAY_LIMIT_DEFAULT : Number(query.limit);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > OPEN_DAY_LIMIT_MAX) throw invalid('limit');
  const cursor = query.cursor === undefined || query.cursor === '' ? null : decodeCursor(query.cursor);
  return { limit: rawLimit, cursor };
}

module.exports = {
  invalid,
  assertSafeInteger,
  assertPathId,
  assertAllowedKeys,
  normalizeOpenAttempt,
  normalizeAttemptFinish,
  normalizeIssueContext,
  normalizeOpenSession,
  normalizeRefresh,
  normalizeClose,
  normalizeSelfMutation,
  normalizeOpenDaysQuery,
  encodeCursor,
  decodeCursor,
  OPEN_DAY_LIMIT_DEFAULT,
  OPEN_DAY_LIMIT_MAX,
};

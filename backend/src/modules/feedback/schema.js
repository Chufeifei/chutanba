/**
 * 现场反馈入参校验（契约 §5.3）。
 * 白名单 6 字段；不接受图片、自填事件时刻或未知字段；坐标只允许 lat/lng/locatedAtMs。
 */
const { DomainError } = require('../../domain/errors');

const FEEDBACK_TYPES = ['OWNER_ABSENT', 'LOCATION_MISMATCH', 'ALREADY_LEFT'];
const ID_PATTERN = /^\d{1,20}$/;
const MAX_DESCRIPTION_CODE_POINTS = 300;
const MAX_TOKEN_LENGTH = 400;
const ALLOWED_FIELDS = [
  'observationId', 'type', 'description', 'locationContextToken', 'location', 'expectedObservationVersion',
];
const LOCATION_FIELDS = ['lat', 'lng', 'locatedAtMs'];
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function invalid(field, reason = 'INVALID') {
  return new DomainError('VALIDATION_FAILED', '请求参数不合法', { fields: [{ field, reason }] });
}

function assertObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('body');
}

function assertId(value, field) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || BigInt(value) <= 0n) throw invalid(field);
  return BigInt(value).toString();
}

function assertDescription(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalid('description', 'TYPE');
  const text = value.trim();
  if (Array.from(text).length > MAX_DESCRIPTION_CODE_POINTS) throw invalid('description', 'TOO_LONG');
  if (CONTROL_CHARS.test(text)) throw invalid('description', 'ILLEGAL_CHARS');
  return text === '' ? null : text;
}

function assertCoordinate(value, field, limit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(field, 'TYPE');
  if (value < -limit || value > limit) throw invalid(field, 'OUT_OF_RANGE');
  return value;
}

/** 反馈定位只收 3 个字段：位置名称不是受理依据，避免把自由文本带进事实表。 */
function assertLocation(value) {
  assertObject(value);
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!LOCATION_FIELDS.includes(key)) throw invalid(`location.${key}`, 'UNKNOWN_FIELD');
  }
  if (keys.length !== LOCATION_FIELDS.length) throw invalid('location', 'REQUIRED_FIELDS');
  if (!Number.isSafeInteger(value.locatedAtMs) || value.locatedAtMs < 0) {
    throw invalid('location.locatedAtMs', 'TYPE');
  }
  return {
    lat: assertCoordinate(value.lat, 'location.lat', 90),
    lng: assertCoordinate(value.lng, 'location.lng', 180),
    locatedAtMs: value.locatedAtMs,
  };
}

/** 版本号是库内自增计数，只接受正整数，避免字符串比较带来的错判。 */
function assertVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid('expectedObservationVersion', 'TYPE');
  return value;
}

function parseSubmitInput(body) {
  assertObject(body);
  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.includes(key)) throw invalid(key, 'UNKNOWN_FIELD');
  }
  if (!FEEDBACK_TYPES.includes(body.type)) throw invalid('type', 'UNSUPPORTED_TYPE');
  if (body.observationId === undefined) throw invalid('observationId', 'REQUIRED_FIELDS');
  if (body.expectedObservationVersion === undefined) throw invalid('expectedObservationVersion', 'REQUIRED_FIELDS');
  if (body.locationContextToken === undefined) throw invalid('locationContextToken', 'REQUIRED_FIELDS');
  if (body.location === undefined) throw invalid('location', 'REQUIRED_FIELDS');
  const token = body.locationContextToken;
  if (typeof token !== 'string' || token.length < 1 || token.length > MAX_TOKEN_LENGTH) {
    throw invalid('locationContextToken', 'TYPE');
  }
  return {
    observationId: assertId(body.observationId, 'observationId'),
    type: body.type,
    description: assertDescription(body.description),
    locationContextToken: token,
    location: assertLocation(body.location),
    expectedObservationVersion: assertVersion(body.expectedObservationVersion),
  };
}

/** 本人记录列表：游标由服务端按 (submitted_at_ms, id) 生成。 */
function parseListQuery(query) {
  const input = query === undefined || query === null ? {} : query;
  for (const key of Object.keys(input)) {
    if (key !== 'cursor' && key !== 'limit') throw invalid(key, 'UNKNOWN_FIELD');
  }
  const cursor = input.cursor === undefined || input.cursor === null || input.cursor === ''
    ? null : String(input.cursor);
  if (cursor !== null && !/^\d{1,16}_\d{1,20}$/.test(cursor)) throw invalid('cursor');
  const limit = input.limit === undefined || input.limit === null || input.limit === ''
    ? 20 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid('limit');
  return {
    cursor: cursor === null ? null : {
      submittedAtMs: Number(cursor.split('_')[0]),
      factId: cursor.split('_')[1],
    },
    limit,
  };
}

module.exports = {
  FEEDBACK_TYPES, parseSubmitInput, parseListQuery, assertId,
};

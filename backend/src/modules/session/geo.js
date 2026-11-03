/**
 * 定位结果校验（纯函数）。
 * 需求出处：prd R3 与 doc/MVP/一期技术设计.md §5 —— 只收白名单字段，
 * 不做精度门槛与坐标取整；定位时间是「本人在此设备报告的时刻」，必须落在上下文有效期内。
 */
const { DomainError } = require('../../domain/errors');

const MAX_LOCATION_AGE_MS = 5 * 60 * 1000;
const MAX_NAME_CODE_POINTS = 80;
const ALLOWED_FIELDS = ['lat', 'lng', 'locationName', 'locatedAtMs'];
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

function shapeInvalid(field) {
  return new DomainError('VALIDATION_FAILED', '定位字段不合法', { fields: [field] });
}

function locationInvalid(field, message) {
  return new DomainError('LOCATION_INVALID', message, { fields: [field] });
}

function assertAllowedFields(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw shapeInvalid('location');
  const keys = Object.keys(input);
  if (keys.length !== ALLOWED_FIELDS.length) throw shapeInvalid('location');
  for (const key of keys) {
    if (!ALLOWED_FIELDS.includes(key)) throw shapeInvalid(key);
  }
}

function assertCoordinate(value, field, limit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw shapeInvalid(field);
  if (value < -limit || value > limit) throw locationInvalid(field, '定位坐标超出取值范围');
  return value;
}

function assertLocationName(value) {
  if (typeof value !== 'string') throw shapeInvalid('locationName');
  const name = value.trim();
  const length = Array.from(name).length;
  if (length < 1 || length > MAX_NAME_CODE_POINTS) {
    throw locationInvalid('locationName', '位置名称长度必须在 1～80 个字符之间');
  }
  if (CONTROL_CHARS.test(name)) throw locationInvalid('locationName', '位置名称包含非法字符');
  return name;
}

/** 定位时刻不得早于上下文签发时刻、不得晚于服务端当前时刻，且不得超过 5 分钟。 */
function assertLocatedAt(value, { nowMs, issuedAtMs }) {
  if (!Number.isSafeInteger(value) || value < 0) throw shapeInvalid('locatedAtMs');
  if (value < issuedAtMs) throw locationInvalid('locatedAtMs', '定位结果早于本次定位请求');
  if (value > nowMs) throw locationInvalid('locatedAtMs', '定位结果晚于服务器当前时刻');
  if (nowMs - value > MAX_LOCATION_AGE_MS) throw locationInvalid('locatedAtMs', '定位结果已过期，请重新定位');
  return value;
}

function normalizeLocation(input, { nowMs, issuedAtMs }) {
  assertAllowedFields(input);
  return {
    lat: assertCoordinate(input.lat, 'lat', 90),
    lng: assertCoordinate(input.lng, 'lng', 180),
    locationName: assertLocationName(input.locationName),
    locatedAtMs: assertLocatedAt(input.locatedAtMs, { nowMs, issuedAtMs }),
  };
}

module.exports = { normalizeLocation, MAX_LOCATION_AGE_MS, ALLOWED_FIELDS };

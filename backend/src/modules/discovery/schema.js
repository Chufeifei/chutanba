/**
 * 公开接口入参校验（契约 §5.1）。
 * 白名单式：出现契约未定义的字段一律 VALIDATION_FAILED，尤其显式拒绝区域与半径筛选，
 * 也不接受客户端自填的事件时刻（事件时刻只能取主库时间）。坐标只允许 lat/lng。
 */
const { DomainError } = require('../../domain/errors');
const { isCategoryCode } = require('./categories');

const ID_PATTERN = /^\d{1,20}$/;
const OBSERVATION_SOURCES = ['DETAIL'];

function invalid(field, reason = 'INVALID') {
  return new DomainError('VALIDATION_FAILED', '请求参数不合法', { fields: [{ field, reason }] });
}

function assertObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('body');
}

/** 只拒绝未知字段，不要求字段齐全：缺省与可选字段由各用例自行判断。 */
function assertAllowedKeys(input, allowed) {
  assertObject(input);
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw invalid(key, 'UNKNOWN_FIELD');
  }
}

function assertPathId(value, field) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw invalid(field);
  const parsed = BigInt(value);
  if (parsed <= 0n) throw invalid(field);
  return parsed.toString();
}

function assertOptionalId(value, field) {
  if (value === undefined || value === null) return null;
  return assertPathId(value, field);
}

function assertCoordinate(value, field, limit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(field);
  if (value < -limit || value > limit) throw invalid(field);
  return value;
}

function parseViewerLocation(value) {
  if (value === undefined || value === null) return null;
  assertObject(value);
  const keys = Object.keys(value);
  for (const key of keys) {
    if (key !== 'lat' && key !== 'lng') throw invalid(`viewerLocation.${key}`, 'UNKNOWN_FIELD');
  }
  if (keys.length !== 2) throw invalid('viewerLocation', 'REQUIRED_FIELDS');
  return {
    lat: assertCoordinate(value.lat, 'viewerLocation.lat', 90),
    lng: assertCoordinate(value.lng, 'viewerLocation.lng', 180),
  };
}

/** 一期只接受品类筛选与顾客定位；regionId / radiusM 属未来能力，出现即拒绝。 */
function parseSearchInput(body) {
  const input = body === undefined || body === null ? {} : body;
  assertAllowedKeys(input, ['categoryCode', 'viewerLocation']);
  if (input.categoryCode !== undefined && input.categoryCode !== null
    && !isCategoryCode(input.categoryCode)) {
    throw invalid('categoryCode', 'UNKNOWN_CATEGORY');
  }
  return {
    categoryCode: input.categoryCode === undefined || input.categoryCode === null
      ? null : input.categoryCode,
    viewerLocation: parseViewerLocation(input.viewerLocation),
  };
}

function parseVendorId(value) {
  return assertPathId(value, 'vendorId');
}

function parseObservationInput(body) {
  assertAllowedKeys(body, ['source', 'sessionId', 'locationVersionId']);
  if (!OBSERVATION_SOURCES.includes(body.source)) throw invalid('source', 'UNSUPPORTED_SOURCE');
  if (body.sessionId === undefined) throw invalid('sessionId', 'REQUIRED_FIELDS');
  if (body.locationVersionId === undefined) throw invalid('locationVersionId', 'REQUIRED_FIELDS');
  return {
    source: body.source,
    sessionId: assertPathId(body.sessionId, 'sessionId'),
    locationVersionId: assertPathId(body.locationVersionId, 'locationVersionId'),
  };
}

function parseNavigationCheckInput(body) {
  const input = body === undefined || body === null ? {} : body;
  assertAllowedKeys(input, ['expectedSessionId', 'expectedLocationVersionId', 'confirmPrepared']);
  if (input.confirmPrepared !== undefined && input.confirmPrepared !== null
    && typeof input.confirmPrepared !== 'boolean') {
    throw invalid('confirmPrepared', 'TYPE');
  }
  return {
    expectedSessionId: assertOptionalId(input.expectedSessionId, 'expectedSessionId'),
    expectedLocationVersionId: assertOptionalId(input.expectedLocationVersionId, 'expectedLocationVersionId'),
    confirmPrepared: input.confirmPrepared === true,
    confirmProvided: input.confirmPrepared !== undefined && input.confirmPrepared !== null,
  };
}

function parseLaunchInput(body) {
  assertAllowedKeys(body, ['navigationCheckId']);
  if (body.navigationCheckId === undefined) throw invalid('navigationCheckId', 'REQUIRED_FIELDS');
  return { navigationCheckId: assertPathId(body.navigationCheckId, 'navigationCheckId') };
}

module.exports = {
  parseSearchInput,
  parseVendorId,
  parseObservationInput,
  parseNavigationCheckInput,
  parseLaunchInput,
  assertPathId,
};

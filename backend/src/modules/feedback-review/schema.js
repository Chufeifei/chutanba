/**
 * 管理侧反馈复核入参校验（契约 §5.4）。
 *
 * 白名单严格：管理决定只接受事实结论与事项版本，不接受坐标、反馈人或其他自由字段。
 * 逐事实理由码区分「证据不足」与「证明确无异常」——两者结论相同但含义不同，
 * 不能合并成一个 NOT_CONFIRM 了事。
 */
const { DomainError } = require('../../domain/errors');

const STATUSES = ['PENDING', 'CONFIRMED', 'NOT_CONFIRMED'];
const ID_PATTERN = /^\d{1,20}$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const MAX_REASON_TEXT = 500;
const MAX_FACTS = 50;

/** CONFIRM 表示核实成立；NOT_CONFIRM 区分「查不清」与「查清了没问题」。 */
const REASON_CODES = Object.freeze({
  CONFIRM: ['ON_SITE_CONFIRMED', 'OWNER_ACKNOWLEDGED'],
  NOT_CONFIRM: ['INSUFFICIENT_EVIDENCE', 'NO_ANOMALY_PROVEN'],
});

function invalid(field, reason = 'INVALID') {
  return new DomainError('VALIDATION_FAILED', '请求参数不合法', { fields: [{ field, reason }] });
}

function assertObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('body');
}

function assertAllowed(body, allowed) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw invalid(key, 'UNKNOWN_FIELD');
  }
}

function assertId(value, field) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || BigInt(value) <= 0n) throw invalid(field);
  return BigInt(value).toString();
}

function assertReasonText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalid('reasonText', 'TYPE');
  const text = value.trim();
  if (Array.from(text).length > MAX_REASON_TEXT) throw invalid('reasonText', 'TOO_LONG');
  if (CONTROL_CHARS.test(text)) throw invalid('reasonText', 'ILLEGAL_CHARS');
  return text === '' ? null : text;
}

function assertVersion(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid(field, 'TYPE');
  return value;
}

function parseListQuery(query) {
  const input = query || {};
  assertAllowed(input, ['status', 'cursor', 'limit']);
  const status = input.status === undefined || input.status === null || input.status === ''
    ? null : String(input.status);
  if (status !== null && !STATUSES.includes(status)) throw invalid('status', 'UNSUPPORTED_VALUE');
  const rawCursor = input.cursor === undefined || input.cursor === null || input.cursor === ''
    ? null : String(input.cursor);
  if (rawCursor !== null && !/^\d{1,16}_\d{1,20}$/.test(rawCursor)) throw invalid('cursor');
  const limit = input.limit === undefined || input.limit === null || input.limit === ''
    ? 20 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid('limit', 'OUT_OF_RANGE');
  return {
    status,
    cursor: rawCursor === null ? null : {
      openedAtMs: Number(rawCursor.split('_')[0]),
      caseId: rawCursor.split('_')[1],
    },
    limit,
  };
}

function parseFactResult(item, index) {
  const field = `factResults[${index}]`;
  assertObject(item);
  for (const key of Object.keys(item)) {
    if (!['factId', 'result', 'reasonCode', 'reasonText'].includes(key)) throw invalid(`${field}.${key}`, 'UNKNOWN_FIELD');
  }
  if (item.factId === undefined) throw invalid(`${field}.factId`, 'REQUIRED_FIELDS');
  if (!REASON_CODES[item.result]) throw invalid(`${field}.result`, 'UNSUPPORTED_VALUE');
  if (!REASON_CODES[item.result].includes(item.reasonCode)) throw invalid(`${field}.reasonCode`, 'UNSUPPORTED_VALUE');
  return {
    factId: assertId(item.factId, `${field}.factId`),
    result: item.result,
    reasonCode: item.reasonCode,
    reasonText: assertReasonText(item.reasonText),
  };
}

/** 结论必须覆盖事项当前全部事实：允许缺省是漏判，允许多余是误判到别的事项。 */
function parseDecision(body) {
  assertObject(body);
  assertAllowed(body, ['factResults', 'expectedTaskVersion']);
  if (!Array.isArray(body.factResults) || body.factResults.length === 0) {
    throw invalid('factResults', 'REQUIRED_FIELDS');
  }
  if (body.factResults.length > MAX_FACTS) throw invalid('factResults', 'TOO_MANY');
  if (body.expectedTaskVersion === undefined) throw invalid('expectedTaskVersion', 'REQUIRED_FIELDS');
  const factResults = body.factResults.map(parseFactResult);
  const seen = new Set();
  for (const item of factResults) {
    if (seen.has(item.factId)) throw invalid('factResults', 'DUPLICATE_FACT');
    seen.add(item.factId);
  }
  return {
    factResults,
    expectedTaskVersion: assertVersion(body.expectedTaskVersion, 'expectedTaskVersion'),
  };
}

function parseCorrection(body) {
  assertObject(body);
  assertAllowed(body, ['sourceCaseId', 'action', 'reason', 'expectedSessionVersion']);
  if (body.action !== 'CLOSE_CURRENT') throw invalid('action', 'UNSUPPORTED_VALUE');
  if (body.sourceCaseId === undefined) throw invalid('sourceCaseId', 'REQUIRED_FIELDS');
  if (typeof body.reason !== 'string') throw invalid('reason', 'TYPE');
  const reason = body.reason.trim();
  if (reason === '') throw invalid('reason', 'REQUIRED_FIELDS');
  if (Array.from(reason).length > MAX_REASON_TEXT) throw invalid('reason', 'TOO_LONG');
  if (CONTROL_CHARS.test(reason)) throw invalid('reason', 'ILLEGAL_CHARS');
  if (body.expectedSessionVersion === undefined) throw invalid('expectedSessionVersion', 'REQUIRED_FIELDS');
  return {
    sourceCaseId: assertId(body.sourceCaseId, 'sourceCaseId'),
    reason,
    expectedSessionVersion: assertVersion(body.expectedSessionVersion, 'expectedSessionVersion'),
  };
}

/**
 * 结论必须覆盖事项当前全部事实：少判是漏判，多判是判到了别的事项。
 * 纯函数，便于不依赖数据库回归这条硬约束。
 */
function assertFactCoverage(currentFactIds, factResults) {
  const current = new Set(currentFactIds.map(String));
  const given = new Set(factResults.map((item) => String(item.factId)));
  const sameSize = current.size === given.size;
  const sameMembers = [...current].every((id) => given.has(id));
  if (!sameSize || !sameMembers) {
    throw new DomainError('VALIDATION_FAILED', '结论必须覆盖该事项当前全部事实', {
      fields: [{ field: 'factResults', reason: 'FACT_SET_MISMATCH' }],
    });
  }
  return true;
}

module.exports = {
  STATUSES,
  REASON_CODES,
  parseListQuery,
  parseDecision,
  parseCorrection,
  assertFactCoverage,
  assertId,
};

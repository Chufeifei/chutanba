/**
 * 管理侧入参校验：治理动作与摊主检索（契约 §5.4）。
 * 管理路径不接受客户端声明的角色、操作者或范围，身份只来自可信网关。
 */
const { DomainError } = require('../../domain/errors');

const ID_PATTERN = /^\d{1,20}$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const MAX_REASON = 500;
const MAX_KEYWORD = 40;
const ACTIONS = ['PAUSE', 'RESTORE'];

function invalid(field, reason = 'INVALID') {
  return new DomainError('VALIDATION_FAILED', '请求参数不合法', { fields: [{ field, reason }] });
}

function assertId(value, field) {
  const text = String(value === undefined || value === null ? '' : value);
  if (!ID_PATTERN.test(text) || BigInt(text) <= 0n) throw invalid(field);
  return BigInt(text).toString();
}

function assertBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('body');
}

/** 治理理由必填：没有理由的暂停与恢复无法向本人说明，也无法事后追溯。 */
function parseGovernanceInput(body) {
  assertBody(body);
  for (const key of Object.keys(body)) {
    if (!['action', 'reason', 'expectedGovernanceVersion'].includes(key)) throw invalid(key, 'UNKNOWN_FIELD');
  }
  if (!ACTIONS.includes(body.action)) throw invalid('action', 'UNSUPPORTED_VALUE');
  if (typeof body.reason !== 'string') throw invalid('reason', 'TYPE');
  const reason = body.reason.trim();
  if (reason === '') throw invalid('reason', 'REQUIRED_FIELDS');
  if (Array.from(reason).length > MAX_REASON) throw invalid('reason', 'TOO_LONG');
  if (CONTROL_CHARS.test(reason)) throw invalid('reason', 'ILLEGAL_CHARS');
  if (!Number.isSafeInteger(body.expectedGovernanceVersion) || body.expectedGovernanceVersion < 1) {
    throw invalid('expectedGovernanceVersion', 'TYPE');
  }
  return { action: body.action, reason, expectedGovernanceVersion: body.expectedGovernanceVersion };
}

function parseVendorQuery(query) {
  const input = query || {};
  for (const key of Object.keys(input)) {
    if (!['keyword', 'cursor', 'limit'].includes(key)) throw invalid(key, 'UNKNOWN_FIELD');
  }
  let keyword = null;
  if (input.keyword !== undefined && input.keyword !== null && input.keyword !== '') {
    if (typeof input.keyword !== 'string') throw invalid('keyword', 'TYPE');
    keyword = input.keyword.trim();
    if (keyword === '') throw invalid('keyword', 'REQUIRED_FIELDS');
    if (Array.from(keyword).length > MAX_KEYWORD) throw invalid('keyword', 'TOO_LONG');
    if (CONTROL_CHARS.test(keyword)) throw invalid('keyword', 'ILLEGAL_CHARS');
  }
  const rawCursor = input.cursor === undefined || input.cursor === null || input.cursor === ''
    ? null : String(input.cursor);
  if (rawCursor !== null && !ID_PATTERN.test(rawCursor)) throw invalid('cursor');
  const limit = input.limit === undefined || input.limit === null || input.limit === ''
    ? 20 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid('limit', 'OUT_OF_RANGE');
  return { keyword, cursor: rawCursor, limit };
}

module.exports = {
  ACTIONS, parseGovernanceInput, parseVendorQuery, assertId, MAX_REASON,
};

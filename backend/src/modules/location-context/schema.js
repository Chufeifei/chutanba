/**
 * 定位上下文令牌：用途白名单 + 目标 ID 形状。
 * 令牌本身是 HMAC 结果（base64url），只把摘要落库；明文不写日志、不入库。
 */
const { DomainError } = require('../../domain/errors');

const PURPOSES = ['OPEN', 'REFRESH'];
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,512}$/;
const ID_PATTERN = /^\d{1,20}$/;

function invalid(field, reason = 'INVALID') {
  return new DomainError('VALIDATION_FAILED', '请求参数不合法', { fields: [{ field, reason }] });
}

function assertPurpose(purpose) {
  if (!PURPOSES.includes(purpose)) throw invalid('purpose');
  return purpose;
}

function assertTargetId(targetId) {
  if (typeof targetId !== 'string' || !ID_PATTERN.test(targetId) || BigInt(targetId) <= 0n) {
    throw invalid('targetId');
  }
  return targetId;
}

function assertToken(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw invalid('locationContextToken');
  return token;
}

module.exports = { PURPOSES, assertPurpose, assertTargetId, assertToken };

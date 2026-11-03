/**
 * 公开匿名会话与观察领取令牌。
 *
 * 匿名会话令牌 = base64url(随机 16B) + '.' + 签发时刻(36 进制) + '.' + HMAC-SHA256 签名，
 * 只用于匿名去重、导航复核归属与观察领取，不授予任何权限；库里只存 sha256 摘要。
 * 领取令牌内容可重算（不能存明文），因此幂等回放时仍能返回同一令牌。
 */
const crypto = require('node:crypto');

const { DomainError } = require('../../domain/errors');
const env = require('../../config/env');
const { sha256Hex } = require('../../utils/digest');

const CLOCK_SKEW_MS = 60_000;

function readSecret() {
  const secret = env.publicTokens && env.publicTokens.secret;
  // 缺失密钥时写端点必须拒签，否则会签发可预测令牌。
  if (!secret) throw new DomainError('SERVICE_UNAVAILABLE', '公开令牌密钥未配置');
  return secret;
}

function sign(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function issueToken(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new TypeError('nowMs 必须是毫秒安全整数');
  const payload = `${crypto.randomBytes(16).toString('base64url')}.${nowMs.toString(36)}`;
  return `${payload}.${sign(readSecret(), payload)}`;
}

function verifyToken(token, nowMs) {
  if (typeof token !== 'string' || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(readSecret(), payload);
  const actualBuffer = Buffer.from(parts[2]);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false;
  const issuedAtMs = Number.parseInt(parts[1], 36);
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) return false;
  if (issuedAtMs > nowMs + CLOCK_SKEW_MS) return false;
  return nowMs - issuedAtMs <= env.publicTokens.sessionTtlMs;
}

function hashToken(token) {
  return sha256Hex(token);
}

/** 未识别身份的观察领取令牌：内容为 observationId + 事件时刻，W6 凭此绑定反馈。 */
function computeClaimToken({ observationId, eventAtMs }) {
  const payload = `${observationId}.${eventAtMs}`;
  return `${payload}.${sign(readSecret(), payload)}`;
}

module.exports = {
  hasSecret: () => Boolean(env.publicTokens && env.publicTokens.secret),
  issueToken,
  verifyToken,
  hashToken,
  computeClaimToken,
};

/**
 * 定位上下文令牌（一次性）。
 *
 * 令牌 = base64url(HMAC-SHA256(secret, "<accountId>|<purpose>|<targetId>|<Idempotency-Key>"))，
 * 库里只留 sha256 摘要，因此同一幂等键重放时可以用同一公式重算出原令牌，无需存明文。
 * 归属校验（目标是否属于本人）留在 session / W6 的反馈域，本模块只认账号与用途。
 */
const crypto = require('node:crypto');

const { DomainError } = require('../../domain/errors');
const env = require('../../config/env');
const repository = require('./repository');
const mapper = require('./mapper');

const CONTEXT_TTL_MS = 5 * 60 * 1000;

function readSecret() {
  const secret = env.locationContext && env.locationContext.secret;
  // 生产环境缺失密钥时必须拒签，不能退化成可预测令牌。
  if (!secret) throw new DomainError('SERVICE_UNAVAILABLE', '定位上下文密钥未配置');
  return secret;
}

function digest(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function computeToken({ accountId, purpose, targetId, key }) {
  return crypto
    .createHmac('sha256', readSecret())
    .update(`${accountId}|${purpose}|${targetId}|${key}`)
    .digest('base64url');
}

async function issueInTransaction(connection, {
  accountId, purpose, targetId, key, nowMs,
}) {
  const token = computeToken({ accountId, purpose, targetId, key });
  const issuedAtMs = nowMs;
  const expiresAtMs = nowMs + CONTEXT_TTL_MS;
  const contextId = await repository.insert(connection, {
    tokenHash: digest(token), accountId, purpose, targetId, issuedAtMs, expiresAtMs,
  });
  return { ...mapper.toIssued({ token, issuedAtMs, expiresAtMs }), contextRef: `lc:${contextId}` };
}

/** 幂等回放：只按原记录重算令牌，不新开记录、不延长有效期。 */
async function recomputeToken(connection, { contextId, accountId, purpose, targetId, key }) {
  const row = await repository.findById(connection, contextId);
  if (!row || Number(row.account_id) !== Number(accountId) || row.purpose !== purpose
    || String(row.target_id) !== String(targetId)) {
    throw new DomainError('STATE_CONFLICT', '定位上下文结果不可用，请重试');
  }
  const token = computeToken({ accountId, purpose, targetId, key });
  return mapper.toIssued({
    contextId: Number(row.id),
    token,
    issuedAtMs: Number(row.issued_at_ms),
    expiresAtMs: Number(row.expires_at_ms),
  });
}

/**
 * 消费：存在但已用／过期 → CONTEXT_EXPIRED；不存在、账号／用途／目标不符 → RESOURCE_NOT_FOUND，
 * 避免按令牌枚举他人在途上下文。恰好第 5 分钟仍允许消费。
 */
async function consumeInTransaction(connection, {
  accountId, purpose, targetId, token, nowMs,
}) {
  const row = await repository.findByHashForUpdate(connection, digest(token));
  if (!row || Number(row.account_id) !== Number(accountId) || row.purpose !== purpose
    || String(row.target_id) !== String(targetId)) {
    throw new DomainError('RESOURCE_NOT_FOUND');
  }
  if (row.used_at_ms !== null || nowMs > Number(row.expires_at_ms)) {
    throw new DomainError('CONTEXT_EXPIRED');
  }
  const changed = await repository.markUsed(connection, { contextId: Number(row.id), usedAtMs: nowMs });
  if (changed === 0) throw new DomainError('CONTEXT_EXPIRED');
  return { contextId: Number(row.id), issuedAtMs: Number(row.issued_at_ms), expiresAtMs: Number(row.expires_at_ms) };
}

module.exports = {
  CONTEXT_TTL_MS,
  computeToken,
  issueInTransaction,
  recomputeToken,
  consumeInTransaction,
};

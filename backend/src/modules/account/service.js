const { withTransaction } = require('../../db/transaction');
const { nowMs } = require('../../db/clock');
const { DomainError } = require('../../domain/errors');
const audit = require('../audit');
const authorization = require('../authorization');
const repository = require('./repository');
const mapper = require('./mapper');
const { assertIdentity } = require('./schema');

function assertUsable(account) {
  if (account.status !== 'ACTIVE') {
    throw new DomainError('PERMISSION_DENIED', '账号当前不可用');
  }
  return account;
}

/** 首次可信访问创建最小账号；账号创建属于身份供给，写一条 GENERAL 审计。 */
async function insertAccount(connection, identity) {
  const occurredAtMs = await nowMs(connection);
  let accountId;
  try {
    accountId = await repository.insertAccount(connection, {
      openid: identity.openid, unionid: identity.unionid, nowMs: occurredAtMs,
    });
  } catch (error) {
    // 非空 unionid 撞到其他账号时放弃 unionid 写入，按 openid 继续；不合并两个身份。
    if (error.code !== 'ER_DUP_ENTRY' || !identity.unionid) throw error;
    accountId = await repository.insertAccount(connection, {
      openid: identity.openid, unionid: null, nowMs: occurredAtMs,
    });
  }
  await audit.record(connection, {
    actionCode: 'ACCOUNT_CREATED',
    actorAccountId: null,
    targetType: 'ACCOUNT',
    targetId: accountId,
    occurredAtMs,
    resultCode: 'SUCCESS',
    retentionClass: 'GENERAL',
  });
  const row = await repository.findById(connection, accountId);
  if (!row) throw new DomainError('STATE_CONFLICT', '账号创建失败，请重试');
  return row;
}

async function resolveInTransaction(connection, identity) {
  const existing = await repository.findByOpenid(connection, identity.openid);
  if (existing) return assertUsable(mapper.toAccount(existing));
  return assertUsable(mapper.toAccount(await insertAccount(connection, identity)));
}

/** 并发首登冲突后必须在新事务重读：旧事务的读快照看不到对方刚提交的账号。 */
async function loadExisting(identity) {
  const row = await withTransaction((connection) => repository.findByOpenid(connection, identity.openid));
  if (!row) throw new DomainError('STATE_CONFLICT', '账号创建结果未知，请重试');
  return assertUsable(mapper.toAccount(row));
}

async function resolveAccount(identity) {
  assertIdentity(identity);
  try {
    return await withTransaction((connection) => resolveInTransaction(connection, identity));
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    return loadExisting(identity);
  }
}

async function readMe(connection, identity) {
  const account = await resolveInTransaction(connection, identity);
  await authorization.syncFromConfig(connection, account, identity.openid);
  const capabilities = await authorization.getCapabilities(connection, account.id);
  const vendorId = await repository.findActiveVendorId(connection, account.id);
  return mapper.toMe(account, capabilities, vendorId);
}

/** GET /me：账号解析、部署名单授权同步、能力计算与摊主绑定一次事务内完成。 */
async function getMe(identity) {
  assertIdentity(identity);
  try {
    return await withTransaction((connection) => readMe(connection, identity));
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    return withTransaction((connection) => readMe(connection, identity));
  }
}

/**
 * 清空非必要账号资料：只提供事务内入口，由清除域在自己已打开的事务里调用。
 * 重复执行不产生额外改动（已是空值时不改写），保证清理批次可重跑。
 */
async function clearProfileInTransaction(connection, { accountId, nowMs }) {
  return repository.clearProfileFields(connection, { accountId, nowMs });
}

/**
 * 锁账号行并读回版本：清除请求要在锁内比对账号版本，避免并发清除互相覆盖。
 */
async function lockAccountInTransaction(connection, { accountId }) {
  return repository.lockAccount(connection, accountId);
}

module.exports = {
  resolveAccount,
  getMe,
  clearProfileInTransaction,
  lockAccountInTransaction,
};

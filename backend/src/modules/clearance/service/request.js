/**
 * 清除请求成立（契约 §5.3）。
 *
 * 请求成立即生效，同一事务内完成：
 * 结束当前轮次 → 写本人停止列 → 清生效资料指针并冻结待审资料 → 写清除请求与审计。
 * 之后作业失败、重试或迟到的审核都不能把资料重新公开。
 */
const { withTransaction } = require('../../../db/transaction');
const { nowMs } = require('../../../db/clock');
const { DomainError } = require('../../../domain/errors');
const account = require('../../account');
const audit = require('../../audit');
const operation = require('../../operation');
const profile = require('../../profile');
const retention = require('../../retention');
const session = require('../../session');
const mapper = require('../mapper');
const repository = require('../repository');
const schema = require('../schema');

const OPERATION_TYPE = 'DATA_CLEAR_REQUEST';
const REF_PREFIX = 'dc';

function unwrap(outcome, payload) {
  if (outcome.status === 'PROCESSING') return outcome;
  if (outcome.status === 'FAILED') throw new DomainError(outcome.bizCode);
  return { ...(outcome.replayed ? outcome.result : payload), replayed: outcome.replayed };
}

function scopeUpgradeRequired() {
  return new DomainError('VALIDATION_FAILED', '清除范围需要包含摊主资料，请改选 ALL', {
    fields: [{ field: 'scope', reason: 'SCOPE_UPGRADE_REQUIRED' }],
  });
}

async function executeRequest(connection, { actorId, input, operationId }) {
  const occurredAtMs = await nowMs(connection);
  // 锁账号行：同账号的清除请求串行化，账号版本也在锁内比对。
  const accountRow = await account.lockAccountInTransaction(connection, { accountId: actorId });
  if (!accountRow) throw new DomainError('RESOURCE_NOT_FOUND');
  if (input.expectedAccountVersion !== Number(accountRow.version)) {
    throw new DomainError('STATE_CONFLICT', '账号信息已更新，请刷新后重试', {
      resource: 'account', currentVersion: Number(accountRow.version),
    });
  }
  const vendor = await session.findVendorByAccountInTransaction(connection, { accountId: actorId });
  const vendorId = vendor ? Number(vendor.id) : null;
  // 只清账号资料会留下无主摊主：拒绝并要求本人明确改选 ALL，不静默替本人做决定。
  if (input.scope === 'ACCOUNT_DATA' && vendorId !== null) throw scopeUpgradeRequired();

  const affectedKinds = mapper.kindsOf(input.scope);
  let invalidatedProfileVersions = 0;
  if (vendorId !== null) {
    // 锁摊主行后按「本人停止公开」处理：结束当前轮次 + 写本人停止列。
    const vendorRow = await session.lockVendorInTransaction(connection, { vendorId });
    await session.applySelfStopInTransaction(connection, {
      vendor: vendorRow, actorAccountId: actorId, operationId, occurredAtMs,
    });
    // 资料停止公开：清生效指针并把待审资料置无效，清除后不得自动恢复公开。
    const cleared = await profile.clearPublicProfileInTransaction(connection, { vendorId, nowMs: occurredAtMs });
    invalidatedProfileVersions = cleared.invalidatedVersions;
  }

  const dueAtMs = retention.clearRequestDueAtMs(occurredAtMs);
  const requestId = await repository.insertRequest(connection, {
    accountId: actorId,
    vendorId,
    scopeJson: {
      requestedScope: input.scope,
      effectiveScope: input.scope,
      affectedKinds,
      invalidatedProfileVersions,
    },
    status: 'QUEUED',
    acceptedAtMs: occurredAtMs,
    dueAtMs,
  });
  await audit.record(connection, {
    actionCode: 'DATA_CLEAR_REQUESTED',
    actorAccountId: actorId,
    targetType: 'DATA_CLEAR_REQUEST',
    targetId: requestId,
    occurredAtMs,
    resultCode: 'QUEUED',
    reasonSummary: input.scope,
    operationId,
    retentionClass: 'GENERAL',
  });
  return {
    payload: {
      clearRequestId: String(requestId),
      status: 'QUEUED',
      requestedAtMs: occurredAtMs,
      affectedKinds,
    },
    resultRef: `${REF_PREFIX}:${requestId}`,
  };
}

async function reloadRequest(resultRef) {
  const requestId = String(resultRef || '').startsWith(`${REF_PREFIX}:`)
    ? String(resultRef).slice(REF_PREFIX.length + 1) : null;
  if (!requestId || !/^\d{1,20}$/.test(requestId)) throw new DomainError('STATE_CONFLICT', '清除请求不可用，请重试');
  return withTransaction(async (connection) => {
    const row = await repository.findRequestById(connection, requestId);
    if (!row) throw new DomainError('STATE_CONFLICT', '清除请求不可用，请重试');
    const scope = mapper.parseScopeJson(row.scope_json) || {};
    return {
      clearRequestId: String(row.id),
      status: row.status,
      requestedAtMs: Number(row.accepted_at_ms),
      affectedKinds: Array.isArray(scope.affectedKinds) ? scope.affectedKinds : [],
    };
  });
}

/** 本人提交清除请求：范围、账号预期版本与幂等键缺一不可。 */
async function submitClearRequest(identity, key, body) {
  const actor = await account.resolveAccount(identity);
  const input = schema.parseSubmitInput(body);
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_TYPE,
    key,
    request: input,
    execute: async (connection, operationId) => {
      const executed = await executeRequest(connection, {
        actorId: actor.id, input, operationId,
      });
      payload = executed.payload;
      return { resultRef: executed.resultRef };
    },
    reload: reloadRequest,
  });
  return unwrap(outcome, payload);
}

/** 本人清除请求列表：只给本人的处理状态与保留依据。 */
async function listMyRequests(identity, query) {
  const actor = await account.resolveAccount(identity);
  const input = schema.parseListQuery(query);
  return withTransaction(async (connection) => {
    const now = await nowMs(connection);
    const rows = await repository.listRequestsForAccount(connection, {
      accountId: actor.id, cursor: input.cursor, limit: input.limit,
    });
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page.map((row) => mapper.toRequestItem(row, { nowMs: now })),
      nextCursor: hasMore && last ? `${last.accepted_at_ms}_${last.id}` : null,
    };
  });
}

/** 本人清除请求详情：他人请求一律按不存在返回。 */
async function getMyRequest(identity, requestId) {
  const actor = await account.resolveAccount(identity);
  return withTransaction(async (connection) => {
    const now = await nowMs(connection);
    const row = await repository.findRequestById(connection, requestId);
    if (!row || Number(row.account_id) !== Number(actor.id)) throw new DomainError('RESOURCE_NOT_FOUND');
    return mapper.toRequestItem(row, { nowMs: now });
  });
}

module.exports = { submitClearRequest, listMyRequests, getMyRequest };

/**
 * 清理批次：逐类幂等执行，分类别表述隐藏、已清除与必要保留。
 *
 * 调度、游标与重试策略属 W12 作业；本包只交付可被作业调用的领域方法：
 * 每类独立事务，失败记原因可重试，已成功的类别重复执行不产生二次改动。
 */
const { withTransaction } = require('../../../db/transaction');
const { nowMs } = require('../../../db/clock');
const { DomainError } = require('../../../domain/errors');
const account = require('../../account');
const audit = require('../../audit');
const profile = require('../../profile');
const retention = require('../../retention');
const session = require('../../session');
const mapper = require('../mapper');
const repository = require('../repository');
const { readRetentionExceptions } = require('./exceptions');

/** 单类执行：失败只记原因，不影响其他类别。 */
async function runCategory(action) {
  try {
    return { count: await action() };
  } catch (error) {
    return { error };
  }
}

function recordFailure(summary, kind, error) {
  summary.failures.push({
    kind,
    reason: error && error.bizCode ? error.bizCode : 'INTERNAL_ERROR',
    retryable: true,
  });
}

/** 清空账号资料：昵称、头像、手机号。登录关联永远保留。 */
async function clearAccountProfile(summary, { accountId, now }) {
  const outcome = await runCategory(() => withTransaction((connection) => account.clearProfileInTransaction(connection, {
    accountId, nowMs: now,
  })));
  if (outcome.error) recordFailure(summary, 'ACCOUNT_PROFILE', outcome.error);
  else summary.cleared.push({ kind: 'ACCOUNT_PROFILE', count: outcome.count });
}

/** 资料内容去标识化：保留版本行与审核痕迹，只换掉可清除的完整值。 */
async function clearVendorProfile(summary, { vendorId }) {
  const outcome = await runCategory(() => withTransaction((connection) => profile.deidentifyProfileContentInTransaction(connection, {
    vendorId, tombstone: mapper.TOMBSTONE,
  })));
  if (outcome.error) recordFailure(summary, 'VENDOR_PROFILE', outcome.error);
  else summary.cleared.push({ kind: 'VENDOR_PROFILE', count: outcome.count });
}

/**
 * 位置坐标去标识化：只清理「无未结挂起且延期已到期」的位置版本。
 * 未结事项与未到期延期的位置按保留规则留下，结果里逐类说明依据与到期时间。
 */
async function clearVendorLocations(summary, { vendorId, now }) {
  const locations = await withTransaction((connection) => session.listVendorLocationsInTransaction(connection, { vendorId }));
  const retentions = await withTransaction((connection) => retention.resolveLocationRetentionsInTransaction(connection, {
    locations: locations.map((row) => ({
      id: Number(row.id),
      stoppedAtMs: row.stopped_at_ms === null ? now : Number(row.stopped_at_ms),
    })),
  }));
  const clearableIds = retentions
    .filter((item) => !item.held && (item.extensionDueAtMs === null || item.extensionDueAtMs <= now))
    .map((item) => item.locationId);
  const outcome = await runCategory(() => withTransaction((connection) => session.deidentifyVendorLocationsInTransaction(connection, {
    vendorId, locationName: mapper.TOMBSTONE.locationName, locationIds: clearableIds,
  })));
  if (outcome.error) recordFailure(summary, 'SESSION_LOCATIONS', outcome.error);
  else summary.cleared.push({ kind: 'SESSION_LOCATIONS', count: outcome.count });
}

/**
 * 执行一次清理批次：幂等、可重试。
 * 已完成的请求直接回放结果，不再改写任何数据。
 */
async function runCleanup(requestId) {
  const id = Number(requestId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new DomainError('VALIDATION_FAILED', '清除请求编号不合法');
  const request = await withTransaction((connection) => repository.findRequestById(connection, id));
  if (!request) throw new DomainError('RESOURCE_NOT_FOUND');
  const now = await withTransaction((connection) => nowMs(connection));
  if (request.status === 'COMPLETED') {
    return withTransaction((connection) => mapper.toRequestItem(request, { nowMs: now }));
  }
  const scope = mapper.parseScopeJson(request.scope_json) || {};
  const effectiveScope = scope.effectiveScope || 'ALL';
  const accountId = Number(request.account_id);
  const vendorId = request.vendor_id === null ? null : Number(request.vendor_id);
  await withTransaction((connection) => repository.markInProgress(connection, { requestId: id }));

  const summary = { hidden: [], cleared: [], retained: [], failures: [] };
  if (effectiveScope !== 'ACCOUNT_DATA') {
    summary.hidden.push({
      kind: 'PUBLIC_PUBLICATION', count: 1, basis: '清除请求成立时按本人停止公开处理并结束当前轮次',
    });
  }
  if (vendorId !== null && Number(scope.invalidatedProfileVersions || 0) > 0) {
    summary.hidden.push({
      kind: 'PENDING_PROFILE',
      count: Number(scope.invalidatedProfileVersions),
      basis: '待审资料置无效，清除后不自动恢复公开',
    });
  }

  if (effectiveScope === 'ACCOUNT_DATA' || effectiveScope === 'ALL') {
    await clearAccountProfile(summary, { accountId, now });
  }
  if (vendorId !== null && (effectiveScope === 'VENDOR_DATA' || effectiveScope === 'ALL')) {
    await clearVendorProfile(summary, { vendorId });
    await clearVendorLocations(summary, { vendorId, now });
  }
  summary.retained = await withTransaction((connection) => readRetentionExceptions(connection, { vendorId, now }));

  const status = summary.failures.length ? 'PARTIAL_FAILED' : 'COMPLETED';
  await withTransaction(async (connection) => {
    await repository.markFinished(connection, {
      requestId: id, status, completedAtMs: now, resultSummaryJson: summary,
    });
    await audit.record(connection, {
      actionCode: 'DATA_CLEAR_COMPLETED',
      actorAccountId: accountId,
      targetType: 'DATA_CLEAR_REQUEST',
      targetId: id,
      occurredAtMs: now,
      resultCode: status,
      reasonSummary: summary.failures.length ? `${summary.failures.length} 类未完成` : null,
      operationId: null,
      retentionClass: 'GENERAL',
    });
  });
  const fresh = await withTransaction((connection) => repository.findRequestById(connection, id));
  return mapper.toRequestItem(fresh, { nowMs: now });
}

/** 待处理队列：清理作业按稳定游标取，本包只提供读方法。 */
async function listQueuedRequests({ limit }) {
  const size = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 50;
  return withTransaction((connection) => repository.listQueuedRequests(connection, { limit: size }));
}

module.exports = { runCleanup, listQueuedRequests };

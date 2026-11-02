const { withTransaction } = require('../../../db/transaction');
const { nowMs } = require('../../../db/clock');
const { DomainError } = require('../../../domain/errors');
const account = require('../../account');
const authorization = require('../../authorization');
const audit = require('../../audit');
const operation = require('../../operation');
const repository = require('../repository');
const schema = require('../schema');
const { conflict, parseRef, loadCapabilities, assertReviewer } = require('./guards');

const OPERATION_TYPE = 'PROFILE_REVIEW_DECISION';

function alreadyProcessed() {
  return new DomainError('ALREADY_PROCESSED', '该资料申请已有处理结果', { resource: 'profileReview' });
}

async function assertLockedVersion(connection, submissionId, expectedTaskVersion) {
  const version = await repository.findVersionByIdForUpdate(connection, submissionId);
  if (!version) throw new DomainError('RESOURCE_NOT_FOUND');
  // 先比较版本再比较状态：并发审批的失败方必须得到契约规定的 STATE_CONFLICT。
  if (expectedTaskVersion !== Number(version.task_version)) {
    throw conflict('profileReview', Number(version.task_version));
  }
  // INVALIDATED（清除范围相交，W8 写入）与已终态申请都不得再次获批。
  if (version.review_status !== 'PENDING') throw alreadyProcessed();
  return version;
}

async function writeDecision(connection, { version, actorId, input, occurredAtMs, operationId }) {
  const reviewStatus = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  let decisionId;
  try {
    decisionId = await repository.insertReviewEvent(connection, {
      versionId: Number(version.id), decision: input.decision, reason: input.reason,
      actorAccountId: actorId, decidedAtMs: occurredAtMs, operationId,
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw alreadyProcessed();
    throw error;
  }
  const changed = await repository.markVersionDecided(connection, {
    versionId: Number(version.id), reviewStatus, decidedAtMs: occurredAtMs,
  });
  if (changed === 0) throw alreadyProcessed();
  if (input.decision === 'APPROVE') {
    await repository.setActiveProfileVersion(connection, {
      vendorId: Number(version.vendor_id), versionId: Number(version.id), nowMs: occurredAtMs,
    });
  } else {
    await repository.updateVendorStateVersion(connection, {
      vendorId: Number(version.vendor_id), nowMs: occurredAtMs,
    });
  }
  return { decisionId, reviewStatus };
}

async function executeDecide(connection, { actorId, submissionId, input, operationId }) {
  const occurredAtMs = await nowMs(connection);
  assertReviewer(await authorization.getCapabilities(connection, actorId));
  const initial = await repository.findVersionById(connection, submissionId);
  if (!initial) throw new DomainError('RESOURCE_NOT_FOUND');
  const vendor = await repository.findVendorByIdForUpdate(connection, initial.vendor_id);
  if (!vendor) throw new DomainError('RESOURCE_NOT_FOUND');
  const version = await assertLockedVersion(connection, submissionId, input.expectedTaskVersion);
  const { decisionId, reviewStatus } = await writeDecision(connection, {
    version, actorId, input, occurredAtMs, operationId,
  });
  await audit.record(connection, {
    actionCode: 'PROFILE_REVIEW_DECIDED',
    actorAccountId: actorId,
    targetType: 'PROFILE_VERSION',
    targetId: submissionId,
    occurredAtMs,
    resultCode: input.decision,
    // 管理审计只记决定码，不复制审核正文，避免受限内容出现在审计摘要里。
    reasonSummary: input.decision,
    operationId,
    retentionClass: 'MANAGEMENT',
  });
  const result = { decisionId: String(decisionId), reviewStatus, decidedAtMs: occurredAtMs };
  if (input.decision === 'APPROVE') result.activeProfileVersionId = String(submissionId);
  return result;
}

async function reloadDecision(resultRef) {
  const versionId = parseRef(resultRef, 'pr');
  return withTransaction(async (connection) => {
    const version = await repository.findVersionById(connection, versionId);
    if (!version) throw new DomainError('STATE_CONFLICT', '决定结果不可用，请重试');
    const event = await repository.findReviewEvent(connection, versionId);
    const result = {
      decisionId: event ? String(event.id) : null,
      reviewStatus: version.review_status,
      decidedAtMs: Number(version.decided_at_ms),
    };
    if (event && event.decision === 'APPROVE') result.activeProfileVersionId = String(versionId);
    return result;
  });
}

function unwrap(outcome, payload) {
  if (outcome.status === 'PROCESSING') return outcome;
  if (outcome.status === 'FAILED') throw new DomainError(outcome.bizCode);
  return { ...(outcome.replayed ? outcome.result : payload), replayed: outcome.replayed };
}

async function decide(identity, submissionId, key, body) {
  const actor = await account.resolveAccount(identity);
  assertReviewer(await loadCapabilities(actor.id));
  const versionId = schema.assertSubmissionId(submissionId);
  const input = schema.normalizeDecision(body);
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_TYPE,
    key,
    request: { submissionId: String(versionId), ...input },
    execute: async (connection, operationId) => {
      payload = await executeDecide(connection, { actorId: actor.id, submissionId: versionId, input, operationId });
      return { resultRef: `pr:${versionId}` };
    },
    reload: reloadDecision,
  });
  return unwrap(outcome, payload);
}

module.exports = { decide };

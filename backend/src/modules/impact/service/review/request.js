/**
 * 影响复核申请（契约 §5.3 本人端点）。
 *
 * 三条不可让步的规则：
 * 1. 复核只处理影响记录本身：不自动撤销治理暂停，也不自动撤销本人停止；
 * 2. 复核结论不删除原反馈事实与处理历史，只改影响记录状态，由复核申请行留痕；
 * 3. 同一影响的未结复核不重复创建；超过复核期限不再受理。
 */
const { withTransaction } = require('../../../../db/transaction');
const { nowMs } = require('../../../../db/clock');
const { DomainError } = require('../../../../domain/errors');
const account = require('../../../account');
const audit = require('../../../audit');
const feedback = require('../../../feedback');
const operation = require('../../../operation');
const retention = require('../../../retention');
const repository = require('../../repository');
const schema = require('../../schema');
const { unwrap, conflict } = require('./guards');

const OPERATION_REQUEST = 'IMPACT_REVIEW_REQUEST';
const REF_REQUEST = 'ir';
const HOLD_BASIS = Object.freeze({
  FEEDBACK_CASE: '未结现场反馈事项',
  IMPACT_REVIEW: '影响复核待决定',
});

/**
 * 申诉期间把原事项的证据挂起：未结的复核未结束时，位置与证据不得按期限清理。
 * 只在影响来源是反馈事项时挂起；来源是管理措施时没有可挂起的证据。
 */
async function openEvidenceHolds(connection, { impact, reviewId, openedAtMs }) {
  if (impact.source_type !== 'FEEDBACK_CASE') return 0;
  const caseId = Number(impact.source_id);
  const locationIds = await feedback.findLocationIdsByCaseIdInTransaction(connection, caseId);
  for (const locationId of locationIds) {
    await retention.openHoldInTransaction(connection, {
      targetType: retention.TARGET_TYPE.LOCATION_VERSION,
      targetId: locationId,
      sourceType: retention.SOURCE_TYPE.IMPACT_REVIEW,
      sourceId: reviewId,
      basis: HOLD_BASIS.IMPACT_REVIEW,
      openedAtMs,
    });
  }
  await retention.openHoldInTransaction(connection, {
    targetType: retention.TARGET_TYPE.FEEDBACK_CASE,
    targetId: caseId,
    sourceType: retention.SOURCE_TYPE.IMPACT_REVIEW,
    sourceId: reviewId,
    basis: HOLD_BASIS.IMPACT_REVIEW,
    openedAtMs,
  });
  return locationIds.length;
}

async function executeRequest(connection, { actorId, input, operationId }) {
  const occurredAtMs = await nowMs(connection);
  const vendorId = await repository.findVendorIdByAccount(connection, actorId);
  if (vendorId === null) throw new DomainError('RESOURCE_NOT_FOUND');
  // 锁影响记录行：同一影响的并发申请在这里串行化。
  const impact = await repository.findByIdForUpdate(connection, input.impactRecordId);
  if (!impact || Number(impact.vendor_id) !== vendorId) throw new DomainError('RESOURCE_NOT_FOUND');
  if (input.expectedImpactVersion !== Number(impact.version)) {
    throw conflict('impactRecord', Number(impact.version));
  }
  if (occurredAtMs > Number(impact.reviewable_until_ms)) throw new DomainError('WINDOW_CLOSED');
  if (impact.status !== 'ACTIVE') throw new DomainError('ALREADY_PROCESSED', '该影响已有复核结果');
  const pending = await repository.findPendingReviewByImpact(connection, input.impactRecordId);
  if (pending) throw conflict('impactReview', Number(pending.task_version));

  const reviewId = await repository.insertReviewRequest(connection, {
    vendorId,
    impactRecordId: input.impactRecordId,
    statement: input.reason,
    createdAtMs: occurredAtMs,
  });
  await openEvidenceHolds(connection, { impact, reviewId, openedAtMs: occurredAtMs });
  await audit.record(connection, {
    actionCode: 'IMPACT_REVIEW_REQUESTED',
    actorAccountId: actorId,
    targetType: 'IMPACT_REVIEW',
    targetId: reviewId,
    occurredAtMs,
    resultCode: 'PENDING',
    reasonSummary: null,
    operationId,
    retentionClass: 'GENERAL',
  });
  return {
    payload: {
      impactReviewId: String(reviewId),
      status: 'PENDING',
      submittedAtMs: occurredAtMs,
    },
    resultRef: `${REF_REQUEST}:${reviewId}`,
  };
}

async function reloadRequest(resultRef) {
  const reviewId = String(resultRef || '').startsWith(`${REF_REQUEST}:`)
    ? String(resultRef).slice(REF_REQUEST.length + 1) : null;
  if (!reviewId || !/^\d{1,20}$/.test(reviewId)) throw new DomainError('STATE_CONFLICT', '复核申请不可用，请重试');
  return withTransaction(async (connection) => {
    const row = await repository.findReviewById(connection, reviewId);
    if (!row) throw new DomainError('STATE_CONFLICT', '复核申请不可用，请重试');
    return {
      impactReviewId: String(row.id),
      status: row.status,
      submittedAtMs: Number(row.created_at_ms),
    };
  });
}

/** 本人发起影响复核申请：同一影响的未结复核不重复创建，超期不再受理。 */
async function submitReview(identity, key, body) {
  const actor = await account.resolveAccount(identity);
  const input = schema.parseSubmitInput(body);
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_REQUEST,
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

module.exports = { submitReview };

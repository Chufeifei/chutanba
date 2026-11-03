/**
 * 影响复核的管理决定（契约 §5.4 管理端点）。
 *
 * 决定只改影响记录状态：不删原反馈事实与处理历史，也不触碰治理列与本人停止列。
 */
const { withTransaction } = require('../../../../db/transaction');
const { nowMs } = require('../../../../db/clock');
const { DomainError } = require('../../../../domain/errors');
const account = require('../../../account');
const authorization = require('../../../authorization');
const audit = require('../../../audit');
const operation = require('../../../operation');
const retention = require('../../../retention');
const repository = require('../../repository');
const schema = require('../../schema');
const { unwrap, conflict } = require('./guards');

const OPERATION_DECISION = 'IMPACT_REVIEW_DECISION';
const REF_DECISION = 'ird';
const ADMIN_CAPABILITIES = Object.freeze(['ADMIN', 'SUPER_ADMIN']);

async function executeDecision(connection, { actorId, reviewId, input, operationId }) {
  const occurredAtMs = await nowMs(connection);
  // 事务内复核：预检通过后权限可能已被撤销。
  authorization.assertAnyCapability(
    await authorization.getCapabilities(connection, actorId), ADMIN_CAPABILITIES,
  );
  const review = await repository.findReviewByIdForUpdate(connection, reviewId);
  if (!review) throw new DomainError('RESOURCE_NOT_FOUND');
  if (input.expectedTaskVersion !== Number(review.task_version)) {
    throw conflict('impactReview', Number(review.task_version));
  }
  if (review.status !== 'PENDING') throw new DomainError('ALREADY_PROCESSED', '该复核申请已有结论');
  const impact = await repository.findByIdForUpdate(connection, review.impact_record_id);
  if (!impact) throw new DomainError('RESOURCE_NOT_FOUND');

  const closed = await repository.closeReview(connection, {
    reviewId,
    status: input.decision,
    decisionReason: input.reason,
    actorAccountId: actorId,
    decidedAtMs: occurredAtMs,
  });
  if (closed === 0) throw new DomainError('ALREADY_PROCESSED', '该复核申请已有结论');

  // 撤销只改影响记录状态：原反馈事实与处理历史一律保留，可由复核申请行追溯。
  let impactStatus = impact.status;
  if (input.decision === 'REVOKED') {
    await repository.updateStatus(connection, {
      impactRecordId: Number(impact.id), status: 'REVOKED',
    });
    impactStatus = 'REVOKED';
  }
  // 复核期间挂起的证据按「结束时刻 + 30 自然日」保留，与基础期限取较晚者。
  await retention.closeHoldsInTransaction(connection, {
    sourceType: retention.SOURCE_TYPE.IMPACT_REVIEW,
    sourceId: reviewId,
    closedAtMs: occurredAtMs,
  });
  await audit.record(connection, {
    actionCode: 'IMPACT_REVIEW_DECIDED',
    actorAccountId: actorId,
    targetType: 'IMPACT_REVIEW',
    // 路由参数是字符串，审计的目标标识必须是整数。
    targetId: Number(reviewId),
    occurredAtMs,
    resultCode: input.decision,
    reasonSummary: input.reason,
    operationId,
    retentionClass: 'MANAGEMENT',
  });
  return {
    payload: {
      impactReviewId: String(reviewId),
      impactRecordId: String(impact.id),
      status: input.decision,
      impactStatus,
      decidedAtMs: occurredAtMs,
    },
    resultRef: `${REF_DECISION}:${reviewId}`,
  };
}

async function reloadDecision(resultRef) {
  const reviewId = String(resultRef || '').startsWith(`${REF_DECISION}:`)
    ? String(resultRef).slice(REF_DECISION.length + 1) : null;
  if (!reviewId || !/^\d{1,20}$/.test(reviewId)) throw new DomainError('STATE_CONFLICT', '复核结果不可用，请重试');
  return withTransaction(async (connection) => {
    const review = await repository.findReviewById(connection, reviewId);
    if (!review) throw new DomainError('STATE_CONFLICT', '复核结果不可用，请重试');
    const impact = await repository.findById(connection, review.impact_record_id);
    return {
      impactReviewId: String(review.id),
      impactRecordId: String(review.impact_record_id),
      status: review.status,
      impactStatus: impact ? impact.status : null,
      decidedAtMs: review.decided_at_ms === null ? null : Number(review.decided_at_ms),
    };
  });
}

/** 管理复核决定：只改影响记录状态，不动治理暂停与本人停止。 */
async function decideReview(identity, reviewId, key, body) {
  const actor = await account.resolveAccount(identity);
  const input = schema.parseDecision(body);
  authorization.assertAnyCapability(
    await withTransaction((connection) => authorization.getCapabilities(connection, actor.id)),
    ADMIN_CAPABILITIES,
  );
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_DECISION,
    key,
    request: { reviewId: String(reviewId), ...input },
    execute: async (connection, operationId) => {
      const executed = await executeDecision(connection, {
        actorId: actor.id, reviewId, input, operationId,
      });
      payload = executed.payload;
      return { resultRef: executed.resultRef };
    },
    reload: reloadDecision,
  });
  return unwrap(outcome, payload);
}

module.exports = { decideReview };

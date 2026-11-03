/**
 * 反馈事项决定（契约 §5.4）。
 *
 * 结论必须覆盖事项当前全部事实：少判与多判都会让「逐事实可追溯」失去意义。
 * 任一事实成立则事项成立；结案本身不结束当前轮次、不暂停公开，
 * 当前营业纠错必须另行调用纠错端点。
 */
const { withTransaction } = require('../../db/transaction');
const { nowMs } = require('../../db/clock');
const { DomainError } = require('../../domain/errors');
const account = require('../account');
const authorization = require('../authorization');
const audit = require('../audit');
const impact = require('../impact');
const operation = require('../operation');
const repository = require('./repository');
const mapper = require('./mapper');
const schema = require('./schema');

const OPERATION_TYPE = 'FEEDBACK_REVIEW_DECISION';
const REF_PREFIX = 'fc';
const CAPABILITY = 'FIELD_REVIEWER';

const TYPE_LABEL = Object.freeze({
  OWNER_ABSENT: '摊主不在现场',
  LOCATION_MISMATCH: '位置与实际不符',
  ALREADY_LEFT: '摊主已提前离开',
});

function conflict(currentVersion) {
  return new DomainError('STATE_CONFLICT', '事项已更新，请刷新后重试', {
    resource: 'feedbackCase', currentVersion,
  });
}

/** 事实集合必须与当前库内事实一一对应；多一条或漏一条都拒绝，并指出不一致而非静默裁剪。 */
function assertCoversAllFacts(facts, factResults) {
  return schema.assertFactCoverage(facts.map((row) => String(row.id)), factResults);
}

async function writeDecisions(connection, { reviewId, factResults, decidedAtMs }) {
  for (const item of factResults) {
    await repository.insertFactDecision(connection, {
      reviewId,
      factId: Number(item.factId),
      result: item.result,
      reasonCode: item.reasonCode,
      reasonText: item.reasonText,
      decidedAtMs,
    });
  }
}

async function executeDecision(connection, {
  actorId, caseId, input, operationId,
}) {
  const occurredAtMs = await nowMs(connection);
  // 事务内复核：预检通过后权限可能已被撤销。
  authorization.assertCapability(
    await authorization.getCapabilities(connection, actorId), CAPABILITY,
  );
  const caseRow = await repository.findCaseForUpdate(connection, caseId);
  if (!caseRow) throw new DomainError('RESOURCE_NOT_FOUND');
  if (input.expectedTaskVersion !== Number(caseRow.task_version)) {
    throw conflict(Number(caseRow.task_version));
  }
  if (caseRow.status !== 'PENDING') throw new DomainError('ALREADY_PROCESSED', '该事项已有结论');

  const facts = await repository.findFactsWithEvidence(connection, caseId);
  assertCoversAllFacts(facts, input.factResults);

  const confirmedFactIds = input.factResults
    .filter((item) => item.result === 'CONFIRM')
    .map((item) => item.factId);
  const status = confirmedFactIds.length > 0 ? 'CONFIRMED' : 'NOT_CONFIRMED';
  // 事项级理由只留理由码集合，逐事实说明写在 cb_feedback_fact_decision.reason_text。
  const reasonCodes = [...new Set(input.factResults.map((item) => item.reasonCode))].join(',');

  const reviewId = await repository.insertReviewEvent(connection, {
    caseId,
    result: status,
    reason: reasonCodes.slice(0, 500),
    evidenceSummary: null,
    actorAccountId: actorId,
    decidedAtMs: occurredAtMs,
  });
  await writeDecisions(connection, {
    reviewId, factResults: input.factResults, decidedAtMs: occurredAtMs,
  });
  const closed = await repository.closeCase(connection, {
    caseId,
    status,
    resultReasonCode: status === 'CONFIRMED' ? 'FACT_CONFIRMED' : 'FACT_NOT_CONFIRMED',
    closedAtMs: occurredAtMs,
  });
  if (closed === 0) throw new DomainError('ALREADY_PROCESSED', '该事项已有结论');

  let impactRecordId = null;
  if (status === 'CONFIRMED') {
    impactRecordId = await impact.recordInTransaction(connection, {
      vendorId: Number(caseRow.vendor_id),
      sourceType: 'FEEDBACK_CASE',
      sourceId: Number(caseId),
      summary: `现场反馈核实成立：${TYPE_LABEL[caseRow.feedback_type] || caseRow.feedback_type}（${caseRow.event_date}）`,
      createdAtMs: occurredAtMs,
    });
  }

  await audit.record(connection, {
    actionCode: 'FEEDBACK_REVIEW_DECIDED',
    actorAccountId: actorId,
    targetType: 'FEEDBACK_CASE',
    targetId: Number(caseId),
    occurredAtMs,
    resultCode: status,
    // 审计只记结论码，不复制证据正文与反馈人信息。
    reasonSummary: status,
    operationId,
    retentionClass: 'MANAGEMENT',
  });

  return {
    payload: mapper.toDecisionResult({
      caseId, status, confirmedFactIds, impactRecordId, decidedAtMs: occurredAtMs,
    }),
    resultRef: `${REF_PREFIX}:${caseId}`,
  };
}

async function reloadDecision(resultRef) {
  const caseId = String(resultRef || '').startsWith(`${REF_PREFIX}:`)
    ? String(resultRef).slice(REF_PREFIX.length + 1) : null;
  if (!caseId || !/^\d{1,20}$/.test(caseId)) throw new DomainError('STATE_CONFLICT', '决定结果不可用，请重试');
  return withTransaction(async (connection) => {
    const summary = await repository.findCaseSummary(connection, caseId);
    if (!summary) throw new DomainError('STATE_CONFLICT', '决定结果不可用，请重试');
    const review = await repository.findReviewEvent(connection, caseId);
    if (!review) throw new DomainError('STATE_CONFLICT', '决定结果不可用，请重试');
    const decisions = await repository.findFactDecisions(connection, review.id);
    const impactRecordId = await impact.findImpactIdBySource(connection, {
      sourceType: 'FEEDBACK_CASE', sourceId: Number(caseId),
    });
    return mapper.toDecisionResult({
      caseId,
      status: summary.status,
      confirmedFactIds: decisions.filter((row) => row.result === 'CONFIRM').map((row) => String(row.fact_id)),
      impactRecordId,
      decidedAtMs: Number(review.decided_at_ms),
    });
  });
}

function unwrap(outcome, payload) {
  if (outcome.status === 'PROCESSING') return outcome;
  if (outcome.status === 'FAILED') throw new DomainError(outcome.bizCode);
  return { ...(outcome.replayed ? outcome.result : payload), replayed: outcome.replayed };
}

async function decide(identity, caseId, key, body) {
  const actor = await account.resolveAccount(identity);
  const id = schema.assertId(caseId, 'caseId');
  const input = schema.parseDecision(body);
  authorization.assertCapability(
    await withTransaction((connection) => authorization.getCapabilities(connection, actor.id)),
    CAPABILITY,
  );
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_TYPE,
    key,
    request: { caseId: id, ...input },
    execute: async (connection, operationId) => {
      const executed = await executeDecision(connection, {
        actorId: actor.id, caseId: id, input, operationId,
      });
      payload = executed.payload;
      return { resultRef: executed.resultRef };
    },
    reload: reloadDecision,
  });
  return unwrap(outcome, payload);
}

module.exports = { decide };

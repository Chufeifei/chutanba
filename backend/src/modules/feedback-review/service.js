/**
 * 反馈复核读取：列表只给摘要，详情才返回受限证据。
 * 详情读取本身是一次受限访问，必须与查询在同一事务写 MANAGEMENT 审计。
 */
const { withTransaction } = require('../../db/transaction');
const { nowMs } = require('../../db/clock');
const { DomainError } = require('../../domain/errors');
const account = require('../account');
const authorization = require('../authorization');
const audit = require('../audit');
const repository = require('./repository');
const mapper = require('./mapper');
const schema = require('./schema');

const CAPABILITY = 'FIELD_REVIEWER';

function assertReviewer(capabilities) {
  return authorization.assertCapability(capabilities, CAPABILITY);
}

async function loadCapabilities(accountId) {
  return withTransaction((connection) => authorization.getCapabilities(connection, accountId));
}

async function listCases(identity, query) {
  const actor = await account.resolveAccount(identity);
  const input = schema.parseListQuery(query);
  assertReviewer(await loadCapabilities(actor.id));
  return withTransaction(async (connection) => {
    // 列表也要逐次鉴权：撤销授权后下一次请求立即失效。
    assertReviewer(await authorization.getCapabilities(connection, actor.id));
    const rows = await repository.listCases(connection, input);
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page.map(mapper.toCaseSummary),
      nextCursor: hasMore && last ? `${last.opened_at_ms}_${last.id}` : null,
    };
  });
}

async function getCaseDetail(identity, caseId) {
  const actor = await account.resolveAccount(identity);
  const id = schema.assertId(caseId, 'caseId');
  return withTransaction(async (connection) => {
    assertReviewer(await authorization.getCapabilities(connection, actor.id));
    const summary = await repository.findCaseSummary(connection, id);
    if (!summary) throw new DomainError('RESOURCE_NOT_FOUND');
    const facts = await repository.findFactsWithEvidence(connection, id);
    const review = await repository.findReviewEvent(connection, id);
    const decisions = review ? await repository.findFactDecisions(connection, review.id) : [];
    await audit.record(connection, {
      actionCode: 'MANAGEMENT_FEEDBACK_VIEWED',
      actorAccountId: actor.id,
      targetType: 'FEEDBACK_CASE',
      targetId: Number(id),
      occurredAtMs: await nowMs(connection),
      resultCode: 'SUCCESS',
      // 只记录「看过哪条事项」，不把证据正文复制进审计摘要。
      reasonSummary: null,
      operationId: null,
      retentionClass: 'MANAGEMENT',
    });
    return mapper.toCaseDetail({
      summary,
      facts,
      review,
      decisions,
      currentSessionId: summary.current_session_id === null || summary.current_session_id === undefined
        ? null : summary.current_session_id,
    });
  });
}

module.exports = { listCases, getCaseDetail, loadCapabilities, assertReviewer, CAPABILITY };

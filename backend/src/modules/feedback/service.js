/**
 * 现场反馈提交与本人读模型（契约 §5.3）。
 *
 * 三条硬约束（来自 §4 L86-L87）：
 * 1. 受理窗口与 300 米都以**原观察事实**为准，不看摊主当前轮次与当前位置；
 * 2. 定位必须由服务端签发的一次性上下文令牌兑换，客户端时刻只作合理性校验；
 * 3. 提交反馈本身不结束轮次、不暂停公开、不生成影响记录。
 */
const { withTransaction } = require('../../db/transaction');
const { nowMs } = require('../../db/clock');
const { DomainError } = require('../../domain/errors');
const { haversineMeters } = require('../../utils/geo');
const account = require('../account');
const operation = require('../operation');
const observation = require('../observation');
const locationContext = require('../location-context');
const { shanghaiDateKey, MAX_LOCATION_AGE_MS } = require('../session');
const repository = require('./repository');
const mapper = require('./mapper');
const { parseSubmitInput, parseListQuery } = require('./schema');

const OPERATION_TYPE = 'FIELD_FEEDBACK_SUBMIT';
const MAX_DISTANCE_M = 300;
const REF_PREFIX = 'fb';

function unwrap(outcome, payload) {
  if (outcome.status === 'PROCESSING') return outcome;
  if (outcome.status === 'FAILED') throw new DomainError(outcome.bizCode);
  return { ...(outcome.replayed ? outcome.result : payload), replayed: outcome.replayed };
}

/** 定位 freshness：不早于上下文签发、不晚于主库时刻、距提交不超过 5 分钟。 */
function assertLocationFresh(location, { nowMs: atMs, issuedAtMs }) {
  if (location.locatedAtMs < issuedAtMs) {
    throw new DomainError('LOCATION_INVALID', '定位结果早于本次定位请求', { fields: ['locatedAtMs'] });
  }
  if (location.locatedAtMs > atMs) {
    throw new DomainError('LOCATION_INVALID', '定位结果晚于服务器当前时刻', { fields: ['locatedAtMs'] });
  }
  if (atMs - location.locatedAtMs > MAX_LOCATION_AGE_MS) {
    throw new DomainError('LOCATION_INVALID', '定位结果已过期，请重新定位', { fields: ['locatedAtMs'] });
  }
}

/** 待审事项合并：并发插入撞唯一键时重查复用，不把数据库冲突暴露给顾客。 */
async function resolveCaseId(connection, {
  reporterAccountId, vendorId, eventDate, feedbackType, atMs,
}) {
  const existing = await repository.findPendingCaseForUpdate(connection, {
    reporterAccountId, vendorId, eventDate, feedbackType,
  });
  if (existing) return Number(existing.id);
  try {
    return await repository.insertCase(connection, {
      reporterAccountId, vendorId, eventDate, feedbackType, openedAtMs: atMs,
    });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      const again = await repository.findPendingCaseForUpdate(connection, {
        reporterAccountId, vendorId, eventDate, feedbackType,
      });
      if (again) return Number(again.id);
    }
    throw error;
  }
}

async function submitInTransaction(connection, { actor, input, atMs }) {
  const loaded = await observation.loadForFeedback(connection, {
    accountId: actor.id,
    observationId: input.observationId,
    expectedVersion: input.expectedObservationVersion,
    nowMs: atMs,
  });

  // 令牌用途固定 FEEDBACK、目标固定该观察：同一令牌无法用于别的事件。
  const context = await locationContext.consumeInTransaction(connection, {
    accountId: actor.id,
    purpose: 'FEEDBACK',
    targetId: input.observationId,
    token: input.locationContextToken,
    nowMs: atMs,
  });
  assertLocationFresh(input.location, { nowMs: atMs, issuedAtMs: context.issuedAtMs });

  // 距离按原位置版本计算：位置被替换后旧行仍保留原始坐标，不读摊主当前位置。
  const distanceM = haversineMeters(
    { lat: input.location.lat, lng: input.location.lng },
    { lat: Number(loaded.location.lat), lng: Number(loaded.location.lng) },
  );
  if (distanceM > MAX_DISTANCE_M) {
    throw new DomainError('LOCATION_TOO_FAR', '定位距离超出受理范围', {
      distanceM: Number(distanceM.toFixed(1)), limitM: MAX_DISTANCE_M,
    });
  }

  const duplicate = await repository.findFactByDedupe(connection, {
    reporterAccountId: actor.id,
    observationId: input.observationId,
    feedbackType: input.type,
  });
  if (duplicate) throw new DomainError('ALREADY_PROCESSED', '该观察的同类型反馈已提交');

  const eventAtMs = Number(loaded.observation.event_at_ms);
  const caseId = await resolveCaseId(connection, {
    reporterAccountId: actor.id,
    vendorId: Number(loaded.observation.vendor_id),
    eventDate: shanghaiDateKey(eventAtMs),
    feedbackType: input.type,
    atMs,
  });

  const factId = await repository.insertFact(connection, {
    caseId,
    reporterAccountId: actor.id,
    feedbackType: input.type,
    observationId: Number(loaded.observation.id),
    sessionId: Number(loaded.observation.session_id),
    locationVersionId: Number(loaded.observation.location_version_id),
    eventAtMs,
    submittedAtMs: atMs,
    description: input.description,
    reporterLat: input.location.lat,
    reporterLng: input.location.lng,
    reporterLocatedAtMs: input.location.locatedAtMs,
    distanceM: Number(distanceM.toFixed(3)),
  });
  await repository.bumpCase(connection, caseId);

  return {
    payload: mapper.toSubmitResult({
      factId, caseId, acceptedAtMs: atMs, eligibleUntilMs: loaded.eligibleUntilMs,
    }),
    resultRef: `${REF_PREFIX}:${factId}`,
  };
}

async function submitFeedback(identity, key, body) {
  const actor = await account.resolveAccount(identity);
  const input = parseSubmitInput(body);
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_TYPE,
    key,
    request: input,
    execute: async (connection) => {
      const atMs = await nowMs(connection);
      const executed = await submitInTransaction(connection, { actor, input, atMs });
      payload = executed.payload;
      return { resultRef: executed.resultRef };
    },
    reload: async (resultRef) => {
      const factId = String(resultRef).slice(REF_PREFIX.length + 1);
      return withTransaction(async (connection) => {
        const row = await repository.findFactForReporter(connection, {
          factId, reporterAccountId: actor.id,
        });
        if (!row) throw new DomainError('STATE_CONFLICT', '提交结果暂不可用，请重试');
        return mapper.toSubmitResult({
          factId: Number(row.id),
          caseId: Number(row.case_id),
          acceptedAtMs: Number(row.submitted_at_ms),
          eligibleUntilMs: observation.eligibleUntilMs(row),
        });
      });
    },
  });
  return unwrap(outcome, payload);
}

async function listMyFeedback(identity, query) {
  const actor = await account.resolveAccount(identity);
  const input = parseListQuery(query);
  return withTransaction(async (connection) => {
    const rows = await repository.listFacts(connection, {
      reporterAccountId: actor.id, cursor: input.cursor, limit: input.limit,
    });
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page.map(mapper.toListItem),
      nextCursor: hasMore && last ? `${last.submitted_at_ms}_${last.id}` : null,
    };
  });
}

async function getMyFeedback(identity, factId) {
  const actor = await account.resolveAccount(identity);
  return withTransaction(async (connection) => {
    const row = await repository.findFactForReporter(connection, {
      factId, reporterAccountId: actor.id,
    });
    if (!row) throw new DomainError('RESOURCE_NOT_FOUND');
    return mapper.toDetail(row);
  });
}

module.exports = { submitFeedback, listMyFeedback, getMyFeedback, MAX_DISTANCE_M };

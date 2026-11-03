/**
 * 观察领取、候选列表与反馈前置事实读取（契约 §5.3）。
 *
 * 边界：W5 已负责写入观察，本模块只做「一次性绑定 + 读取」；
 * 受理窗口与距离判定统一来自 ./eligibility，反馈域不得自写比较式。
 */
const { withTransaction } = require('../../db/transaction');
const { nowMs } = require('../../db/clock');
const { DomainError } = require('../../domain/errors');
const { sha256Hex } = require('../../utils/digest');
const account = require('../account');
const operation = require('../operation');
const repository = require('./repository');
const mapper = require('./mapper');
const { isEligible, eligibleUntilMs } = require('./eligibility');
const { parseClaimInput, parseCandidateQuery } = require('./schema');

const OPERATION_TYPE = 'OBSERVATION_CLAIM';
const REF_PREFIX = 'obs';

function unwrap(outcome, payload) {
  if (outcome.status === 'PROCESSING') return outcome;
  if (outcome.status === 'FAILED') throw new DomainError(outcome.bizCode);
  return { ...(outcome.replayed ? outcome.result : payload), replayed: outcome.replayed };
}

/** 领取：令牌按摘要定位；已被他人领取即冲突，本人已领取按幂等回放处理。 */
async function claimObservation(identity, key, body) {
  const actor = await account.resolveAccount(identity);
  const input = parseClaimInput(body);
  const tokenHash = sha256Hex(input.claimToken);
  let payload = null;

  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_TYPE,
    key,
    request: { tokenHash },
    execute: async (connection) => {
      const row = await repository.findByClaimHashForUpdate(connection, tokenHash);
      // 查不到不区分「令牌伪造」与「已被领取」，避免按令牌枚举他人观察。
      if (!row) throw new DomainError('RESOURCE_NOT_FOUND');
      if (row.viewer_account_id !== null && row.viewer_account_id !== undefined) {
        if (Number(row.viewer_account_id) !== Number(actor.id)) {
          throw new DomainError('STATE_CONFLICT', '该观察已绑定其他账号');
        }
        const view = await repository.findClaimView(connection, row.id);
        payload = mapper.toClaimResult(view || row);
        return { resultRef: `${REF_PREFIX}:${row.id}` };
      }
      const changed = await repository.claimObservation(connection, {
        observationId: row.id, accountId: actor.id, tokenHash,
      });
      if (changed === 0) throw new DomainError('STATE_CONFLICT', '该观察已被领取');
      const view = await repository.findClaimView(connection, row.id);
      payload = mapper.toClaimResult(view || row);
      return { resultRef: `${REF_PREFIX}:${row.id}` };
    },
    reload: async (resultRef) => {
      const observationId = String(resultRef).slice(REF_PREFIX.length + 1);
      return withTransaction(async (connection) => {
        const view = await repository.findClaimView(connection, observationId);
        if (!view) throw new DomainError('STATE_CONFLICT', '领取结果暂不可用，请重试');
        return mapper.toClaimResult(view);
      });
    },
  });
  return unwrap(outcome, payload);
}

/** 候选：只列本人观察；窗口关闭的条目从可提交候选消失，已提交记录仍可在记录页查到。 */
async function listCandidates(identity, query) {
  const actor = await account.resolveAccount(identity);
  const input = parseCandidateQuery(query);
  return withTransaction(async (connection) => {
    const serverNowMs = await nowMs(connection);
    const rows = await repository.listCandidates(connection, {
      accountId: actor.id, cursor: input.cursor, limit: input.limit,
    });
    const items = [];
    let consumed = 0;
    let lastConsumed = null;
    // 逐行消费：游标按「已消费到的行」前进，窗口外的行不占配额，但也不会让分页错位。
    for (const row of rows) {
      if (items.length >= input.limit) break;
      consumed += 1;
      lastConsumed = row;
      if (!isEligible(row, serverNowMs)) continue;
      items.push(mapper.toCandidate(row, serverNowMs));
    }
    return {
      rows: items,
      nextCursor: rows.length > consumed && lastConsumed
        ? `${lastConsumed.event_at_ms}_${lastConsumed.id}` : null,
    };
  });
}

/**
 * FEEDBACK 用途定位上下文的签发前置：观察必须属于本人且窗口未关闭。
 * 越权与不存在统一 404，避免按观察 ID 探测他人记录。
 */
async function assertFeedbackContextTarget(connection, { accountId, observationId, nowMs: atMs }) {
  const row = await repository.findByIdForUpdate(connection, observationId);
  if (!row || Number(row.viewer_account_id) !== Number(accountId)) {
    throw new DomainError('RESOURCE_NOT_FOUND');
  }
  const session = await repository.findSessionById(connection, row.session_id);
  if (!session || !isEligible(session, atMs)) throw new DomainError('WINDOW_CLOSED');
  return { observationId: String(row.id), eligibleUntilMs: eligibleUntilMs(session) };
}

/**
 * 反馈提交前置：锁观察行、核对版本与窗口，取原轮次与原位置版本。
 * 位置只看观察自带的 location_version_id，不看摊主当前有效位置。
 */
async function loadForFeedback(connection, { accountId, observationId, expectedVersion, nowMs: atMs }) {
  const observation = await repository.findByIdForUpdate(connection, observationId);
  if (!observation || Number(observation.viewer_account_id) !== Number(accountId)) {
    throw new DomainError('RESOURCE_NOT_FOUND');
  }
  if (Number(observation.version) !== Number(expectedVersion)) {
    throw new DomainError('STATE_CONFLICT', '观察已更新，请刷新后重试', {
      resource: 'observation', currentVersion: Number(observation.version),
    });
  }
  const session = await repository.findSessionById(connection, observation.session_id);
  if (!session) throw new DomainError('RESOURCE_NOT_FOUND');
  if (!isEligible(session, atMs)) throw new DomainError('WINDOW_CLOSED');
  const location = await repository.findLocationById(connection, observation.location_version_id);
  if (!location) throw new DomainError('RESOURCE_NOT_FOUND');
  return {
    observation,
    session,
    location,
    eligibleUntilMs: eligibleUntilMs(session),
  };
}

module.exports = { claimObservation, listCandidates, assertFeedbackContextTarget, loadForFeedback };

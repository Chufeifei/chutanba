/**
 * 详情观察事实（契约 §5.1 POST /public/vendors/{id}/observations）。
 * 事件时刻只取主库时间，客户端自填时刻在 schema 阶段即被拒绝；
 * 响应不含坐标；未识别身份才签发 claimToken，已识别身份写 viewer_account_id。
 */
const { withTransaction } = require('../../../db/transaction');
const { DomainError } = require('../../../domain/errors');
const { sha256Hex } = require('../../../utils/digest');
const account = require('../../account');
const session = require('../../session');
const anonymous = require('../anonymous');
const repository = require('../repository');
const mapper = require('../mapper');
const { isPubliclyVisible } = require('./qualify');
const { parseVendorId, parseObservationInput } = require('../schema');
const { runIdempotent } = require('./idempotent');

const OPERATION_TYPE = 'PUBLIC_OBSERVATION';

async function resolveViewerAccountId(identity) {
  if (!identity) return null;
  const actor = await account.resolveAccount(identity);
  return Number(actor.id);
}

async function reloadObservation(resultRef) {
  const observationId = String(resultRef).replace('obs:', '');
  return withTransaction(async (connection) => {
    const row = await repository.findObservationForReload(connection, observationId);
    if (!row) throw new DomainError('STATE_CONFLICT', '观察结果暂不可用，请重试');
    const claimToken = row.viewer_account_id
      ? null
      : anonymous.computeClaimToken({
        observationId: Number(row.id), eventAtMs: Number(row.event_at_ms),
      });
    return mapper.toObservationView({
      observationId: row.id,
      eventAtMs: Number(row.event_at_ms),
      eventPublicStatus: row.event_public_status,
      vendorId: row.vendor_id,
      vendorName: row.vendor_name,
      categoryCode: row.category_code,
      sessionId: row.session_id,
      locationVersionId: row.location_version_id,
      phase: row.event_public_status,
      claimToken,
    });
  });
}

async function createObservation({
  identity, vendorId, idempotencyKey, anonymousSession, body,
}) {
  // 写入必须能签发领取令牌；密钥缺失时宁可 503，也不签可预测令牌。
  if (!anonymousSession || !anonymousSession.hash) {
    throw new DomainError('SERVICE_UNAVAILABLE', '公开令牌密钥未配置');
  }
  const value = parseVendorId(vendorId);
  const input = parseObservationInput(body);
  const viewerAccountId = await resolveViewerAccountId(identity);

  return runIdempotent({
    actorScope: `anon:${anonymousSession.hash}`,
    operationType: OPERATION_TYPE,
    key: idempotencyKey,
    request: {
      vendorId: value,
      source: input.source,
      sessionId: input.sessionId,
      locationVersionId: input.locationVersionId,
    },
    execute: async (connection) => {
      const now = await repository.readNowMs(connection);
      const row = await repository.findPublicRowById(connection, value);
      if (!isPubliclyVisible(row, now)) {
        throw new DomainError('STATE_CONFLICT', '该摊位当前不可记录观察');
      }
      if (String(row.session_id) !== input.sessionId
        || String(row.location_id) !== input.locationVersionId) {
        throw new DomainError('STATE_CONFLICT', '展示的轮次或位置已变化，请刷新后重试');
      }
      const phaseInfo = session.deriveSessionPhase({
        nowMs: now,
        startedAtMs: Number(row.started_at_ms),
        plannedEndAtMs: Number(row.planned_end_at_ms),
      });
      const observationId = await repository.insertObservation(connection, {
        viewerAccountId,
        claimTokenHash: null,
        vendorId: value,
        sessionId: input.sessionId,
        locationVersionId: input.locationVersionId,
        eventAtMs: now,
        source: input.source,
        eventPublicStatus: phaseInfo.phase,
      });
      if (viewerAccountId === null) {
        const claimToken = anonymous.computeClaimToken({ observationId, eventAtMs: now });
        await repository.markObservationClaim(connection, {
          observationId, claimTokenHash: sha256Hex(claimToken),
        });
      }
      return { resultRef: `obs:${observationId}` };
    },
    reload: reloadObservation,
  });
}

module.exports = { createObservation };

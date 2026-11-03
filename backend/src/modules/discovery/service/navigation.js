/**
 * 导航复核与发起（契约 §5.1）。
 * 每次都在主库时刻重查资格与当前位置版本，不读缓存：
 * - 复核只返回资格结论，READY 也不含坐标；
 * - 发起成功后一次性落 launched_at_ms/launch_ref，只有这条分支返回坐标；
 * - 准备收摊（PREPARING）首次只给 CONFIRM_REQUIRED，确认必须换新幂等键再复核。
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
const { parseVendorId, parseNavigationCheckInput, parseLaunchInput } = require('../schema');
const { runIdempotent } = require('./idempotent');

const NAV_CHECK_TTL_MS = 10 * 60 * 1000;
const CHECK_OPERATION = 'PUBLIC_NAVIGATION_CHECK';
const LAUNCH_OPERATION = 'PUBLIC_NAVIGATION_LAUNCH';

function assertAnonymousSession(anonymousSession) {
  if (!anonymousSession || !anonymousSession.hash) {
    throw new DomainError('SERVICE_UNAVAILABLE', '公开令牌密钥未配置');
  }
  return anonymousSession.hash;
}

function phaseInfoOf(row, nowMs) {
  return session.deriveSessionPhase({
    nowMs,
    startedAtMs: Number(row.started_at_ms),
    plannedEndAtMs: Number(row.planned_end_at_ms),
  });
}

function assertSameVersion(row, expectedSessionId, expectedLocationVersionId) {
  const sessionChanged = expectedSessionId !== null
    && String(row.session_id) !== expectedSessionId;
  const locationChanged = expectedLocationVersionId !== null
    && String(row.location_id) !== expectedLocationVersionId;
  if (sessionChanged || locationChanged) {
    throw new DomainError('STATE_CONFLICT', '展示的轮次或位置已变化，请刷新后重试');
  }
}

async function reloadCheck(resultRef) {
  const checkId = Number(String(resultRef).replace('nc:', ''));
  return withTransaction(async (connection) => {
    const row = await repository.findNavigationView(connection, checkId);
    if (!row) throw new DomainError('STATE_CONFLICT', '导航复核结果暂不可用，请重试');
    const now = await repository.readNowMs(connection);
    const plannedEndAtMs = Number(row.planned_end_at_ms);
    const observation = await repository.findObservationById(connection, row.observation_id);
    const claimToken = row.decision === 'READY' && observation && !observation.viewer_account_id
      ? anonymous.computeClaimToken({
        observationId: Number(observation.id), eventAtMs: Number(observation.event_at_ms),
      })
      : null;
    return mapper.toNavigationCheckView({
      navigationCheckId: row.id,
      decision: row.decision,
      observationId: row.observation_id,
      expiresAtMs: Number(row.expires_at_ms),
      plannedEndAtMs,
      remainingMs: Math.max(plannedEndAtMs - now, 0),
      sessionId: row.session_id,
      locationVersionId: row.location_version_id,
      claimToken,
    });
  });
}

async function reloadLaunch(resultRef) {
  const checkId = Number(String(resultRef).replace('nl:', ''));
  return withTransaction(async (connection) => {
    const check = await repository.findNavigationCheckById(connection, checkId);
    if (!check || check.launch_ref === null) {
      throw new DomainError('STATE_CONFLICT', '导航发起结果暂不可用，请重试');
    }
    const observation = await repository.findObservationById(connection, check.observation_id);
    const now = await repository.readNowMs(connection);
    const row = observation
      ? await repository.findPublicRowById(connection, observation.vendor_id)
      : null;
    // 只有轮次与位置版本仍是当前值时才在回放里给出坐标，避免旧位置被复用。
    const stillCurrent = row && isPubliclyVisible(row, now)
      && String(row.session_id) === String(check.session_id)
      && String(row.location_id) === String(check.location_version_id);
    return mapper.toLaunchView({
      launchId: check.launch_ref,
      recordedAtMs: Number(check.launched_at_ms),
      sessionId: check.session_id,
      locationVersionId: check.location_version_id,
      row: stillCurrent ? row : null,
    });
  });
}

async function createNavigationObservation(connection, {
  viewerAccountId, vendorId, row, now, phase,
}) {
  const observationId = await repository.insertObservation(connection, {
    viewerAccountId,
    claimTokenHash: null,
    vendorId,
    sessionId: String(row.session_id),
    locationVersionId: String(row.location_id),
    eventAtMs: now,
    source: 'NAVIGATION',
    eventPublicStatus: phase,
  });
  if (viewerAccountId === null) {
    const claimToken = anonymous.computeClaimToken({ observationId, eventAtMs: now });
    await repository.markObservationClaim(connection, {
      observationId, claimTokenHash: sha256Hex(claimToken),
    });
  }
  return { observationId };
}

async function checkNavigation({
  identity, vendorId, idempotencyKey, anonymousSession, body,
}) {
  const sessionHash = assertAnonymousSession(anonymousSession);
  const value = parseVendorId(vendorId);
  const input = parseNavigationCheckInput(body);
  const viewerAccountId = identity ? Number((await account.resolveAccount(identity)).id) : null;

  return runIdempotent({
    actorScope: `anon:${sessionHash}`,
    operationType: CHECK_OPERATION,
    key: idempotencyKey,
    request: {
      vendorId: value,
      expectedSessionId: input.expectedSessionId,
      expectedLocationVersionId: input.expectedLocationVersionId,
      confirmPrepared: input.confirmProvided ? input.confirmPrepared : null,
    },
    execute: async (connection) => {
      const now = await repository.readNowMs(connection);
      const row = await repository.findPublicRowById(connection, value);
      if (!isPubliclyVisible(row, now)) {
        throw new DomainError('NOT_NAVIGABLE', '该摊位当前不可导航');
      }
      assertSameVersion(row, input.expectedSessionId, input.expectedLocationVersionId);
      const phaseInfo = phaseInfoOf(row, now);
      const decision = phaseInfo.phase === 'PREPARING' && input.confirmPrepared !== true
        ? 'CONFIRM_REQUIRED' : 'READY';
      const { observationId } = await createNavigationObservation(connection, {
        viewerAccountId, vendorId: value, row, now, phase: phaseInfo.phase,
      });
      const checkId = await repository.insertNavigationCheck(connection, {
        observationId,
        anonymousSessionHash: sessionHash,
        sessionId: String(row.session_id),
        locationVersionId: String(row.location_id),
        decision,
        createdAtMs: now,
        expiresAtMs: now + NAV_CHECK_TTL_MS,
      });
      return { resultRef: `nc:${checkId}` };
    },
    reload: reloadCheck,
  });
}

async function launchNavigation({ idempotencyKey, anonymousSession, body }) {
  const sessionHash = assertAnonymousSession(anonymousSession);
  const input = parseLaunchInput(body);
  return runIdempotent({
    actorScope: `anon:${sessionHash}`,
    operationType: LAUNCH_OPERATION,
    key: idempotencyKey,
    request: { navigationCheckId: input.navigationCheckId },
    execute: async (connection) => {
      const now = await repository.readNowMs(connection);
      const check = await repository.findNavigationCheckForUpdate(connection, input.navigationCheckId);
      if (!check || check.anonymous_session_hash !== sessionHash) {
        throw new DomainError('RESOURCE_NOT_FOUND');
      }
      if (check.decision !== 'READY') throw new DomainError('STATE_CONFLICT', '导航复核未就绪');
      if (now > Number(check.expires_at_ms) || now < Number(check.created_at_ms)) {
        throw new DomainError('CONTEXT_EXPIRED');
      }
      if (check.launched_at_ms !== null) {
        throw new DomainError('STATE_CONFLICT', '该导航复核已发起');
      }
      const observation = await repository.findObservationById(connection, check.observation_id);
      if (!observation) throw new DomainError('STATE_CONFLICT', '导航复核上下文缺失');
      const row = await repository.findPublicRowById(connection, observation.vendor_id);
      if (!isPubliclyVisible(row, now)
        || String(row.session_id) !== String(check.session_id)
        || String(row.location_id) !== String(check.location_version_id)) {
        throw new DomainError('NOT_NAVIGABLE', '该摊位当前不可导航');
      }
      const launchRef = sha256Hex(`${check.id}:${now}`).slice(0, 32);
      const changed = await repository.markNavigationCheckLaunched(connection, {
        checkId: check.id, launchedAtMs: now, launchRef,
      });
      if (changed === 0) throw new DomainError('STATE_CONFLICT', '该导航复核已发起');
      return { resultRef: `nl:${check.id}` };
    },
    reload: reloadLaunch,
  });
}

module.exports = { checkNavigation, launchNavigation, NAV_CHECK_TTL_MS };

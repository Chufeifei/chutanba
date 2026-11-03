/**
 * 本人工作台读模型。
 * 需求出处：prd R7 与 doc/MVP/一期技术设计.md §10.1 —— 只读、不锁行、不写业务事实；
 * 到期未物理结束时按 E 派生 RESTING，且不返回旧坐标。
 */
const { withTransaction } = require('../../../db/transaction');
const { nowMs } = require('../../../db/clock');
const { DomainError } = require('../../../domain/errors');
const account = require('../../account');
const publication = require('../../publication');
const mapper = require('../mapper');
const repository = require('../repository');
const time = require('../time');

const RESTING = { phase: 'RESTING', remainingMs: 0 };

function controlsOf(controls) {
  const result = { selfVersion: controls.selfVersion, governanceVersion: controls.governanceVersion };
  if (controls.selfStoppedAtMs !== null) result.selfStoppedAtMs = controls.selfStoppedAtMs;
  if (controls.governancePausedAtMs !== null) result.governancePausedAtMs = controls.governancePausedAtMs;
  return result;
}

/** 到期未结束时结束时刻取 E、原因取 DEADLINE；这些只用于展示，不落库。 */
function describeSession({ row, serverNowMs }) {
  const plannedEndAtMs = Number(row.planned_end_at_ms);
  const expired = row.ended_at_ms === null && serverNowMs >= plannedEndAtMs;
  const live = row.ended_at_ms === null && !expired;
  return {
    live,
    session: mapper.toSessionRef({
      row,
      endedAtMs: row.ended_at_ms !== null ? Number(row.ended_at_ms) : (expired ? plannedEndAtMs : null),
      endReason: row.end_reason || (expired ? 'DEADLINE' : null),
    }),
    ...(live
      ? time.derivePhase({
        nowMs: serverNowMs,
        startedAtMs: Number(row.started_at_ms),
        plannedEndAtMs,
      })
      : RESTING),
  };
}

async function getWorkbench(identity) {
  const actor = await account.resolveAccount(identity);
  return withTransaction(async (connection) => {
    const serverNowMs = await nowMs(connection);
    const vendor = await repository.findVendorByAccount(connection, actor.id);
    if (!vendor) throw new DomainError('RESOURCE_NOT_FOUND');
    if (vendor.lifecycle_status !== 'ACTIVE') throw new DomainError('NOT_ELIGIBLE');
    const vendorId = Number(vendor.id);
    const controls = await publication.getControlsInTransaction(connection, vendorId);
    const row = vendor.current_session_id === null
      ? null
      : await repository.findSessionById(connection, vendor.current_session_id);
    const described = row ? describeSession({ row, serverNowMs }) : null;
    const showLocation = Boolean(described && described.live)
      && controls.selfStoppedAtMs === null && controls.governancePausedAtMs === null;
    const currentLocation = showLocation
      ? mapper.toLocation(await repository.findOpenLocation(connection, Number(row.id)))
      : null;

    const result = {
      serverNowMs,
      vendorId: String(vendor.id),
      stateVersion: Number(vendor.state_version),
      profileEligibility: mapper.toEligibility({
        activeProfileVersionId: vendor.active_profile_version_id,
        controls,
        live: Boolean(described && described.live),
      }),
      publicationControls: controlsOf(controls),
      phase: described ? described.phase : RESTING.phase,
      remainingMs: described ? described.remainingMs : RESTING.remainingMs,
      openTimeCandidates: time.buildOpenTimeCandidates({
        nowMs: serverNowMs,
        lastSelectedClockMin: vendor.last_selected_clock_min === null
          ? null
          : Number(vendor.last_selected_clock_min),
      }),
    };
    if (described) result.session = described.session;
    if (currentLocation) result.currentLocation = currentLocation;
    if (vendor.last_selected_clock_min !== null) {
      result.lastSelectedClockMin = Number(vendor.last_selected_clock_min);
    }
    return result;
  });
}

module.exports = { getWorkbench };

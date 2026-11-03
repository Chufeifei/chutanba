/**
 * 营业域行 → 对外结构：ID 一律字符串、时间一律毫秒整数、坐标转 Number，
 * 内部字段（profile_version_id、active_* 生成列）不对外返回。
 */
function toAttempt(row) {
  const result = {
    attemptId: String(row.id),
    acceptedAtMs: Number(row.accepted_at_ms),
    status: row.status,
  };
  if (row.finished_at_ms !== null && row.finished_at_ms !== undefined) {
    result.finishedAtMs = Number(row.finished_at_ms);
  }
  return result;
}

function toSessionOpened({ sessionId, startedAtMs, plannedEndAtMs, locationVersionId, openDate, stateVersion }) {
  return {
    sessionId: String(sessionId),
    startedAtMs,
    plannedEndAtMs,
    locationVersionId: String(locationVersionId),
    openDate,
    stateVersion,
  };
}

function toSessionRef({ row, endedAtMs, endReason }) {
  return {
    sessionId: String(row.id),
    version: Number(row.version),
    startedAtMs: Number(row.started_at_ms),
    plannedEndAtMs: Number(row.planned_end_at_ms),
    ...(endedAtMs === null || endedAtMs === undefined ? {} : { endedAtMs }),
    ...(endReason === null || endReason === undefined ? {} : { endReason }),
  };
}

function toLocation(row) {
  if (!row) return null;
  return {
    lat: Number(row.lat),
    lng: Number(row.lng),
    locationName: row.location_name,
    locatedAtMs: Number(row.located_at_ms),
  };
}

function toRefreshedLocation({ sessionId, locationVersionId, lastLocatedAtMs, sessionVersion }) {
  return { sessionId: String(sessionId), locationVersionId: String(locationVersionId), lastLocatedAtMs, sessionVersion };
}

function toClosedSession({ row, endedAtMs, endReason }) {
  return {
    sessionId: String(row.id),
    endedAtMs,
    endReason,
    sessionVersion: Number(row.version),
  };
}

function toOpenDayRow({ openDate, sessionCount, firstStartedAtMs, lastEndedAtMs }) {
  return {
    openDate,
    sessionCount,
    firstStartedAtMs,
    ...(lastEndedAtMs === null ? {} : { lastEndedAtMs }),
  };
}

/** 公开控制快照：两类限制分成两个可选字段，不合并成单一开关。 */
function toControlSnapshot(controls, stateVersion) {
  const result = {
    selfVersion: controls.selfVersion,
    governanceVersion: controls.governanceVersion,
    stateVersion,
  };
  if (controls.selfStoppedAtMs !== null) result.selfStoppedAtMs = controls.selfStoppedAtMs;
  if (controls.governancePausedAtMs !== null) result.governancePausedAtMs = controls.governancePausedAtMs;
  return result;
}

/** 开摊资格投影：原因逐条列出，同时存在多条时全部返回，便于前端逐项提示。 */
function toEligibility({ activeProfileVersionId, controls, live }) {
  const reasons = [];
  if (!activeProfileVersionId) reasons.push('PROFILE_REQUIRED');
  if (controls.selfStoppedAtMs !== null) reasons.push('SELF_STOPPED');
  if (controls.governancePausedAtMs !== null) reasons.push('GOVERNANCE_PAUSED');
  if (live) reasons.push('SESSION_ACTIVE');
  const result = {
    eligible: reasons.length === 0,
    activeProfileAvailable: Boolean(activeProfileVersionId),
    reasons,
  };
  if (activeProfileVersionId) result.activeProfileVersionId = String(activeProfileVersionId);
  return result;
}

module.exports = {
  toAttempt,
  toEligibility,
  toControlSnapshot,
  toSessionOpened,
  toSessionRef,
  toLocation,
  toRefreshedLocation,
  toClosedSession,
  toOpenDayRow,
};

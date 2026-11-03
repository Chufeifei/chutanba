/**
 * 营业域唯一写库方：只写 SQL、只返回数据库行，不开事务、不做业务判断。
 * 所有方法复用调用方传入的 connection；锁顺序由 service 保证（摊主 → 轮次 → 位置 → 尝试 → 控制行）。
 */
const VENDOR_COLUMNS = `id, account_id, lifecycle_status, active_profile_version_id,
  current_session_id, state_version, last_selected_clock_min`;
const SESSION_COLUMNS = `id, vendor_id, profile_version_id, started_at_ms, planned_end_at_ms, ended_at_ms,
  end_reason, version, state_version`;
const LOCATION_COLUMNS = `id, session_id, vendor_id, version_no, lat, lng, location_name, located_at_ms,
  effective_at_ms, stopped_at_ms, stop_reason, state_version`;
const ATTEMPT_COLUMNS = `id, vendor_id, planned_end_at_ms, status, accepted_at_ms, finished_at_ms, session_id, state_version`;

async function lockAccount(connection, accountId) {
  await connection.execute('SELECT id FROM cb_user_account WHERE id = ? FOR UPDATE', [accountId]);
}

async function findVendorById(connection, vendorId, { forUpdate = false } = {}) {
  const [rows] = await connection.execute(
    `SELECT ${VENDOR_COLUMNS} FROM cb_vendor_identity WHERE id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [vendorId],
  );
  return rows[0] || null;
}

async function findVendorByAccount(connection, accountId, { forUpdate = false } = {}) {
  const [rows] = await connection.execute(
    `SELECT ${VENDOR_COLUMNS} FROM cb_vendor_identity WHERE active_account_id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [accountId],
  );
  return rows[0] || null;
}

/** 开摊成功：写当前轮次指针、上次钟点，摊主版本递增。 */
async function updateVendorAfterOpen(connection, { vendorId, sessionId, clockMin, nowMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_identity
     SET current_session_id = ?, last_selected_clock_min = ?,
         state_version = state_version + 1, updated_at_ms = ?
     WHERE id = ?`,
    [sessionId, clockMin, nowMs, vendorId],
  );
  return result.affectedRows;
}

/** 只清指向本轮的指针：旧轮次结束不能把后来新开的轮次指针清掉。 */
async function clearVendorSession(connection, { vendorId, sessionId, nowMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_identity
     SET current_session_id = NULL, state_version = state_version + 1, updated_at_ms = ?
     WHERE id = ? AND current_session_id = ?`,
    [nowMs, vendorId, sessionId],
  );
  return result.affectedRows;
}

async function bumpVendorState(connection, { vendorId, nowMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_identity
     SET state_version = state_version + 1, updated_at_ms = ? WHERE id = ?`,
    [nowMs, vendorId],
  );
  return result.affectedRows;
}
async function insertOpenAttempt(connection, { vendorId, plannedEndAtMs, acceptedAtMs }) {
  const [result] = await connection.execute(
    `INSERT INTO cb_vendor_open_attempt (vendor_id, planned_end_at_ms, status, accepted_at_ms, state_version)
     VALUES (?, ?, 'LOCATING', ?, 1)`,
    [vendorId, plannedEndAtMs, acceptedAtMs],
  );
  return Number(result.insertId);
}

async function findOpenAttemptById(connection, attemptId, { forUpdate = false } = {}) {
  const [rows] = await connection.execute(
    `SELECT ${ATTEMPT_COLUMNS} FROM cb_vendor_open_attempt WHERE id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [attemptId],
  );
  return rows[0] || null;
}

async function updateAttemptStatus(connection, { attemptId, status, sessionId, finishedAtMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_open_attempt
     SET status = ?, session_id = ?, finished_at_ms = ?, state_version = state_version + 1 WHERE id = ?`,
    [status, sessionId, finishedAtMs, attemptId],
  );
  return result.affectedRows;
}

async function findSessionById(connection, sessionId, { forUpdate = false } = {}) {
  const [rows] = await connection.execute(
    `SELECT ${SESSION_COLUMNS} FROM cb_vendor_session WHERE id = ?${forUpdate ? ' FOR UPDATE' : ''}`,
    [sessionId],
  );
  return rows[0] || null;
}

async function insertSession(connection, {
  vendorId, profileVersionId, startedAtMs, plannedEndAtMs,
}) {
  const [result] = await connection.execute(
    `INSERT INTO cb_vendor_session
       (vendor_id, profile_version_id, started_at_ms, planned_end_at_ms, version, state_version)
     VALUES (?, ?, ?, ?, 1, 1)`,
    [vendorId, profileVersionId, startedAtMs, plannedEndAtMs],
  );
  return Number(result.insertId);
}

async function endSessionRow(connection, { sessionId, endedAtMs, endReason }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_session
     SET ended_at_ms = ?, end_reason = ?, version = version + 1, state_version = state_version + 1
     WHERE id = ? AND ended_at_ms IS NULL`,
    [endedAtMs, endReason, sessionId],
  );
  return result.affectedRows;
}

async function bumpSessionVersion(connection, sessionId) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_session
     SET version = version + 1, state_version = state_version + 1 WHERE id = ?`,
    [sessionId],
  );
  return result.affectedRows;
}

async function findOpenLocation(connection, sessionId) {
  const [rows] = await connection.execute(
    `SELECT ${LOCATION_COLUMNS} FROM cb_session_location WHERE active_session_id = ? LIMIT 1`,
    [sessionId],
  );
  return rows[0] || null;
}

async function findFirstLocation(connection, sessionId) {
  const [rows] = await connection.execute(
    `SELECT ${LOCATION_COLUMNS} FROM cb_session_location WHERE session_id = ? ORDER BY version_no ASC LIMIT 1`, [sessionId],
  );
  return rows[0] || null;
}

async function findLocationById(connection, locationId) {
  const [rows] = await connection.execute(
    `SELECT ${LOCATION_COLUMNS} FROM cb_session_location WHERE id = ? LIMIT 1`, [locationId],
  );
  return rows[0] || null;
}

async function maxLocationVersion(connection, sessionId) {
  const [rows] = await connection.execute(
    'SELECT COALESCE(MAX(version_no), 0) AS version_no FROM cb_session_location WHERE session_id = ?',
    [sessionId],
  );
  return Number(rows[0].version_no);
}

/** 一并停止本轮所有未停止位置；返回受影响行数用于审计与断言。 */
async function stopOpenLocations(connection, { sessionId, stoppedAtMs, stopReason }) {
  const [result] = await connection.execute(
    `UPDATE cb_session_location
     SET stopped_at_ms = ?, stop_reason = ?, state_version = state_version + 1
     WHERE session_id = ? AND stopped_at_ms IS NULL`,
    [stoppedAtMs, stopReason, sessionId],
  );
  return result.affectedRows;
}

async function insertLocation(connection, {
  sessionId, vendorId, versionNo, location, effectiveAtMs,
}) {
  const [result] = await connection.execute(
    `INSERT INTO cb_session_location
       (session_id, vendor_id, version_no, lat, lng, location_name, located_at_ms, effective_at_ms, state_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [sessionId, vendorId, versionNo, location.lat, location.lng,
      location.locationName, location.locatedAtMs, effectiveAtMs],
  );
  return Number(result.insertId);
}

/** 同日重开只递增已有记录的 state_version，不改变首次轮次指针。 */
async function insertOpenDay(connection, { vendorId, openDate, sessionId, createdAtMs }) {
  const [result] = await connection.execute(
    `INSERT INTO cb_vendor_open_day (vendor_id, open_date, first_session_id, created_at_ms, state_version)
     VALUES (?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE
       state_version = state_version + 1`,
    [vendorId, openDate, sessionId, createdAtMs],
  );
  return result.affectedRows;
}

async function listOpenDays(connection, { vendorId, cursor, limit }) {
  const params = [vendorId];
  let where = 'vendor_id = ?';
  if (cursor) {
    where += ' AND (open_date < ? OR (open_date = ? AND id < ?))';
    params.push(cursor.openDate, cursor.openDate, cursor.id);
  }
  params.push(limit + 1);
  const [rows] = await connection.execute(
    `SELECT id, open_date, first_session_id, state_version FROM cb_vendor_open_day
     WHERE ${where} ORDER BY open_date DESC, id DESC LIMIT ${limit + 1}`,
    params,
  );
  return rows;
}

async function countOpenDays(connection, vendorId) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS total FROM cb_vendor_open_day WHERE vendor_id = ?', [vendorId],
  );
  return Number(rows[0].total);
}

/** 一次性取回当地日期区间内的所有轮次，由 service 在 JS 按 shanghaiDateKey 分组。 */
async function listSessionsByRange(connection, { vendorId, fromMs, toMs }) {
  const [rows] = await connection.execute(
    `SELECT ${SESSION_COLUMNS} FROM cb_vendor_session
     WHERE vendor_id = ? AND started_at_ms >= ? AND started_at_ms < ? ORDER BY started_at_ms ASC`,
    [vendorId, fromMs, toMs],
  );
  return rows;
}


module.exports = {
  lockAccount, findVendorById, findVendorByAccount, updateVendorAfterOpen, clearVendorSession,
  bumpVendorState, insertOpenAttempt, findOpenAttemptById, updateAttemptStatus,
  findSessionById, insertSession, endSessionRow, bumpSessionVersion,
  findOpenLocation, findFirstLocation, findLocationById, maxLocationVersion,
  stopOpenLocations, insertLocation, insertOpenDay, listOpenDays, countOpenDays, listSessionsByRange,
};

/**
 * 管理复核读写的 SQL 集合：只写 SQL，事务与鉴权在 service。
 * 事实永远按自身 session_id / location_version_id 取原轮次与原位置版本，
 * 不使用摊主当前轮次或当前位置，避免把历史证据替换成新位置（AC-16）。
 */
const CASE_SUMMARY_COLUMNS = `c.id, c.status, c.feedback_type, c.opened_at_ms, c.closed_at_ms,
  c.task_version, c.result_reason_code, v.id AS vendor_id,
  p.vendor_name, p.category_code`;

async function countPending(connection) {
  const [rows] = await connection.execute(
    "SELECT COUNT(*) AS n FROM cb_feedback_case WHERE status = 'PENDING'",
  );
  return Number(rows[0].n);
}

async function listCases(connection, { status, cursor, limit }) {
  const params = [];
  const clauses = [];
  if (status) {
    clauses.push('c.status = ?');
    params.push(status);
  }
  if (cursor) {
    clauses.push('(c.opened_at_ms < ? OR (c.opened_at_ms = ? AND c.id < ?))');
    params.push(cursor.openedAtMs, cursor.openedAtMs, cursor.caseId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const [rows] = await connection.execute(
    `SELECT ${CASE_SUMMARY_COLUMNS},
            (SELECT COUNT(*) FROM cb_feedback_fact f WHERE f.case_id = c.id) AS fact_count,
            (SELECT COUNT(DISTINCT f.reporter_account_id) FROM cb_feedback_fact f WHERE f.case_id = c.id) AS reporter_count
     FROM cb_feedback_case c
     JOIN cb_vendor_identity v ON v.id = c.vendor_id
     LEFT JOIN cb_vendor_profile_version p ON p.id = v.active_profile_version_id
     ${where}
     ORDER BY c.opened_at_ms DESC, c.id DESC
     LIMIT ${Number(limit) + 1}`,
    params,
  );
  return rows;
}

async function findCaseSummary(connection, caseId) {
  const [rows] = await connection.execute(
    `SELECT ${CASE_SUMMARY_COLUMNS}, v.current_session_id,
            (SELECT COUNT(*) FROM cb_feedback_fact f WHERE f.case_id = c.id) AS fact_count,
            (SELECT COUNT(DISTINCT f.reporter_account_id) FROM cb_feedback_fact f WHERE f.case_id = c.id) AS reporter_count
     FROM cb_feedback_case c
     JOIN cb_vendor_identity v ON v.id = c.vendor_id
     LEFT JOIN cb_vendor_profile_version p ON p.id = v.active_profile_version_id
     WHERE c.id = ?`,
    [caseId],
  );
  return rows[0] || null;
}

async function findCaseForUpdate(connection, caseId) {
  const [rows] = await connection.execute(
    `SELECT id, reporter_account_id, vendor_id, event_date, feedback_type, status,
            task_version, state_version, opened_at_ms, closed_at_ms
     FROM cb_feedback_case WHERE id = ? FOR UPDATE`,
    [caseId],
  );
  return rows[0] || null;
}

/** 每行事实带原轮次窗口与原位置版本坐标；is_current 由调用方按摊主当前指针标注。 */
async function findFactsWithEvidence(connection, caseId) {
  const [rows] = await connection.execute(
    `SELECT f.id, f.feedback_type, f.session_id, f.location_version_id, f.event_at_ms,
            f.submitted_at_ms, f.description, f.reporter_lat, f.reporter_lng,
            f.reporter_located_at_ms, f.distance_m,
            s.started_at_ms, s.planned_end_at_ms, s.ended_at_ms, s.end_reason, s.version AS session_version,
            l.version_no, l.lat AS location_lat, l.lng AS location_lng, l.location_name,
            l.effective_at_ms, l.stopped_at_ms
     FROM cb_feedback_fact f
     JOIN cb_vendor_session s ON s.id = f.session_id
     JOIN cb_session_location l ON l.id = f.location_version_id
     WHERE f.case_id = ?
     ORDER BY f.event_at_ms ASC, f.id ASC`,
    [caseId],
  );
  return rows;
}

async function findReviewEvent(connection, caseId) {
  const [rows] = await connection.execute(
    `SELECT id, result, reason, evidence_summary, actor_account_id, decided_at_ms
     FROM cb_feedback_review_event WHERE case_id = ?`,
    [caseId],
  );
  return rows[0] || null;
}

async function findFactDecisions(connection, reviewId) {
  const [rows] = await connection.execute(
    `SELECT fact_id, result, reason_code, reason_text, decided_at_ms
     FROM cb_feedback_fact_decision WHERE review_id = ? ORDER BY fact_id ASC`,
    [reviewId],
  );
  return rows;
}

async function insertReviewEvent(connection, {
  caseId, result, reason, evidenceSummary, actorAccountId, decidedAtMs,
}) {
  const [result0] = await connection.execute(
    `INSERT INTO cb_feedback_review_event
       (case_id, result, reason, evidence_summary, actor_account_id, decided_at_ms, state_version)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [caseId, result, reason, evidenceSummary, actorAccountId, decidedAtMs],
  );
  return Number(result0.insertId);
}

async function insertFactDecision(connection, {
  reviewId, factId, result, reasonCode, reasonText, decidedAtMs,
}) {
  const [inserted] = await connection.execute(
    `INSERT INTO cb_feedback_fact_decision
       (review_id, fact_id, result, reason_code, reason_text, decided_at_ms, state_version)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [reviewId, factId, result, reasonCode, reasonText, decidedAtMs],
  );
  return Number(inserted.insertId);
}

async function closeCase(connection, { caseId, status, resultReasonCode, closedAtMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_feedback_case
     SET status = ?, result_reason_code = ?, closed_at_ms = ?, state_version = state_version + 1
     WHERE id = ? AND status = 'PENDING'`,
    [status, resultReasonCode, closedAtMs, caseId],
  );
  return result.affectedRows;
}

/** 纠错前置：事项必须真的关联过该轮次，防止按旧事项 ID 误关同日新开的轮次。 */
async function findFactForSession(connection, { caseId, sessionId }) {
  const [rows] = await connection.execute(
    'SELECT id FROM cb_feedback_fact WHERE case_id = ? AND session_id = ? LIMIT 1',
    [caseId, sessionId],
  );
  return rows[0] || null;
}

async function findVendorByIdForUpdate(connection, vendorId) {
  const [rows] = await connection.execute(
    `SELECT id, account_id, lifecycle_status, active_profile_version_id, current_session_id, state_version
     FROM cb_vendor_identity WHERE id = ? FOR UPDATE`,
    [vendorId],
  );
  return rows[0] || null;
}

async function findVendorByCase(connection, caseId) {
  const [rows] = await connection.execute(
    `SELECT v.id, v.current_session_id, v.state_version, v.lifecycle_status
     FROM cb_feedback_case c JOIN cb_vendor_identity v ON v.id = c.vendor_id
     WHERE c.id = ?`,
    [caseId],
  );
  return rows[0] || null;
}

async function findSessionForUpdate(connection, sessionId) {
  const [rows] = await connection.execute(
    `SELECT id, vendor_id, profile_version_id, started_at_ms, planned_end_at_ms,
            ended_at_ms, end_reason, version
     FROM cb_vendor_session WHERE id = ? FOR UPDATE`,
    [sessionId],
  );
  return rows[0] || null;
}

async function findSession(connection, sessionId) {
  const [rows] = await connection.execute(
    `SELECT id, vendor_id, started_at_ms, planned_end_at_ms, ended_at_ms, end_reason, version
     FROM cb_vendor_session WHERE id = ?`,
    [sessionId],
  );
  return rows[0] || null;
}

module.exports = {
  countPending,
  listCases,
  findCaseSummary,
  findCaseForUpdate,
  findFactsWithEvidence,
  findReviewEvent,
  findFactDecisions,
  insertReviewEvent,
  insertFactDecision,
  closeCase,
  findFactForSession,
  findVendorByIdForUpdate,
  findVendorByCase,
  findSessionForUpdate,
  findSession,
};

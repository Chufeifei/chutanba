/**
 * 反馈事实与待审事项的 SQL 集合。
 * 只写 SQL：事务控制在 service；唯一索引是并发与重复提交的最后一道兜底。
 */

const FACT_COLUMNS = `f.id, f.case_id, f.feedback_type, f.observation_id, f.session_id,
  f.location_version_id, f.event_at_ms, f.submitted_at_ms, f.description, f.distance_m`;

/** 同观察同类型只允许一条事实（uq_feedback_fact_dedupe）。 */
async function findFactByDedupe(connection, { reporterAccountId, observationId, feedbackType }) {
  const [rows] = await connection.execute(
    `SELECT ${FACT_COLUMNS} FROM cb_feedback_fact f
     WHERE f.reporter_account_id = ? AND f.observation_id = ? AND f.feedback_type = ?`,
    [reporterAccountId, observationId, feedbackType],
  );
  return rows[0] || null;
}

async function insertFact(connection, input) {
  const [result] = await connection.execute(
    `INSERT INTO cb_feedback_fact
       (case_id, reporter_account_id, feedback_type, observation_id, session_id, location_version_id,
        event_at_ms, submitted_at_ms, description, reporter_lat, reporter_lng, reporter_located_at_ms, distance_m)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.caseId, input.reporterAccountId, input.feedbackType, input.observationId,
      input.sessionId, input.locationVersionId, input.eventAtMs, input.submittedAtMs,
      input.description, input.reporterLat, input.reporterLng, input.reporterLocatedAtMs,
      input.distanceM,
    ],
  );
  return Number(result.insertId);
}

/** 待审事项按（本人、摊主、事件当地日、类型）合并；已结案行不参与匹配，因此不会被重开。 */
async function findPendingCaseForUpdate(connection, {
  reporterAccountId, vendorId, eventDate, feedbackType,
}) {
  const [rows] = await connection.execute(
    `SELECT id, status, task_version, state_version FROM cb_feedback_case
     WHERE reporter_account_id = ? AND vendor_id = ? AND event_date = ?
       AND feedback_type = ? AND status = 'PENDING'
     FOR UPDATE`,
    [reporterAccountId, vendorId, eventDate, feedbackType],
  );
  return rows[0] || null;
}

async function insertCase(connection, {
  reporterAccountId, vendorId, eventDate, feedbackType, openedAtMs,
}) {
  const [result] = await connection.execute(
    `INSERT INTO cb_feedback_case
       (reporter_account_id, vendor_id, event_date, feedback_type, status, task_version, state_version, opened_at_ms)
     VALUES (?, ?, ?, ?, 'PENDING', 1, 1, ?)`,
    [reporterAccountId, vendorId, eventDate, feedbackType, openedAtMs],
  );
  return Number(result.insertId);
}

/** 新增事实后推进事项版本：管理端的 expectedTaskVersion 据此识别并发新增。 */
async function bumpCase(connection, caseId) {
  await connection.execute(
    `UPDATE cb_feedback_case
     SET task_version = task_version + 1, state_version = state_version + 1
     WHERE id = ?`,
    [caseId],
  );
}

/** 本人记录列表：摊主名称取当前生效资料版本，绝不返回坐标与提交者身份之外的字段。 */
async function listFacts(connection, { reporterAccountId, cursor, limit }) {
  const params = [reporterAccountId];
  let cursorClause = '';
  if (cursor) {
    cursorClause = 'AND (f.submitted_at_ms < ? OR (f.submitted_at_ms = ? AND f.id < ?))';
    params.push(cursor.submittedAtMs, cursor.submittedAtMs, cursor.factId);
  }
  // 预编译语句不接受 LIMIT ?：上限已在 schema 校验为 1～50 的整数，直接内联。
  const pageSize = Number(limit) + 1;
  const [rows] = await connection.execute(
    `SELECT ${FACT_COLUMNS}, c.status, c.result_reason_code, c.closed_at_ms,
            p.vendor_name, p.category_code
     FROM cb_feedback_fact f
     JOIN cb_feedback_case c ON c.id = f.case_id
     JOIN cb_vendor_session s ON s.id = f.session_id
     JOIN cb_vendor_identity v ON v.id = c.vendor_id
     LEFT JOIN cb_vendor_profile_version p ON p.id = v.active_profile_version_id
     WHERE f.reporter_account_id = ? ${cursorClause}
     ORDER BY f.submitted_at_ms DESC, f.id DESC
     LIMIT ${pageSize}`,
    params,
  );
  return rows;
}

/** 详情只能按本人查：他人事实与不存在统一 404。 */
async function findFactForReporter(connection, { factId, reporterAccountId }) {
  const [rows] = await connection.execute(
    `SELECT ${FACT_COLUMNS}, c.status, c.result_reason_code, c.closed_at_ms,
            p.vendor_name, p.category_code
     FROM cb_feedback_fact f
     JOIN cb_feedback_case c ON c.id = f.case_id
     JOIN cb_vendor_session s ON s.id = f.session_id
     JOIN cb_vendor_identity v ON v.id = c.vendor_id
     LEFT JOIN cb_vendor_profile_version p ON p.id = v.active_profile_version_id
     WHERE f.id = ? AND f.reporter_account_id = ?`,
    [factId, reporterAccountId],
  );
  return rows[0] || null;
}

module.exports = {
  findFactByDedupe,
  insertFact,
  findPendingCaseForUpdate,
  insertCase,
  bumpCase,
  listFacts,
  findFactForReporter,
};

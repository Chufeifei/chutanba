/**
 * 公开投影与观察的唯一写库方：只写 SQL、只返回数据库行。
 * 公开读取的 WHERE 只在这里出现一份，避免列表能查、详情能查的口径漂移。
 * 本文件不开事务、不做业务判断；资格三态映射在 service/qualify.js。
 */
const { nowMs: readNowMs } = require('../../db/clock');

const PUBLIC_ROW_COLUMNS = `v.id AS vendor_id, v.lifecycle_status, v.active_profile_version_id,
  p.vendor_name, p.category_code, p.regular_items_text, p.price_description, p.announcement,
  c.self_stopped_at_ms, c.governance_paused_at_ms,
  s.id AS session_id, s.started_at_ms, s.planned_end_at_ms, s.ended_at_ms,
  l.id AS location_id, l.lat, l.lng, l.location_name, l.located_at_ms, l.stopped_at_ms`;

/** 列表与计数共用：只在资格成立的集合上查询，任何一项缺失即不纳入。 */
const PUBLIC_WHERE = `v.lifecycle_status = 'ACTIVE'
  AND v.active_profile_version_id IS NOT NULL
  AND c.self_stopped_at_ms IS NULL
  AND c.governance_paused_at_ms IS NULL
  AND s.ended_at_ms IS NULL
  AND s.started_at_ms <= ?
  AND s.planned_end_at_ms > ?
  AND l.stopped_at_ms IS NULL`;

function publicFrom() {
  return `FROM cb_vendor_identity v
    JOIN cb_vendor_profile_version p ON p.id = v.active_profile_version_id
    LEFT JOIN cb_vendor_publication_control c ON c.vendor_id = v.id
    JOIN cb_vendor_session s ON s.active_vendor_id = v.id
    JOIN cb_session_location l ON l.active_session_id = s.id`;
}

function publicParams({ categoryCode, nowMs }) {
  const params = [nowMs, nowMs];
  let clause = PUBLIC_WHERE;
  if (categoryCode) {
    clause += ' AND p.category_code = ?';
    params.push(categoryCode);
  }
  return { clause, params };
}

async function countPublicRows(connection, { categoryCode, nowMs }) {
  const { clause, params } = publicParams({ categoryCode, nowMs });
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS total ${publicFrom()} WHERE ${clause}`,
    params,
  );
  return Number(rows[0].total);
}

async function listPublicRows(connection, { categoryCode, nowMs }) {
  const { clause, params } = publicParams({ categoryCode, nowMs });
  const [rows] = await connection.execute(
    `SELECT ${PUBLIC_ROW_COLUMNS} ${publicFrom()} WHERE ${clause} ORDER BY v.id ASC`,
    params,
  );
  return rows;
}

/** 详情要区分休息与不可查看，因此不套用公开 WHERE，由 service 用同一谓词判定三态。 */
async function findPublicRowById(connection, vendorId) {
  const [rows] = await connection.execute(
    `SELECT ${PUBLIC_ROW_COLUMNS}
     FROM cb_vendor_identity v
     LEFT JOIN cb_vendor_profile_version p ON p.id = v.active_profile_version_id
     LEFT JOIN cb_vendor_publication_control c ON c.vendor_id = v.id
     LEFT JOIN cb_vendor_session s ON s.active_vendor_id = v.id
     LEFT JOIN cb_session_location l ON l.active_session_id = s.id
     WHERE v.id = ? LIMIT 1`,
    [vendorId],
  );
  return rows[0] || null;
}

async function insertObservation(connection, {
  viewerAccountId, claimTokenHash, vendorId, sessionId, locationVersionId,
  eventAtMs, source, eventPublicStatus,
}) {
  const [result] = await connection.execute(
    `INSERT INTO cb_feedback_observation
       (viewer_account_id, claim_token_hash, vendor_id, session_id, location_version_id,
        event_at_ms, source, event_public_status, version, state_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [viewerAccountId, claimTokenHash, vendorId, sessionId, locationVersionId,
      eventAtMs, source, eventPublicStatus],
  );
  return Number(result.insertId);
}

/** 领取令牌依赖插入后生成的观察 ID，因此分两步写入；唯一索引保证一次绑定。 */
async function markObservationClaim(connection, { observationId, claimTokenHash }) {
  const [result] = await connection.execute(
    `UPDATE cb_feedback_observation
     SET claim_token_hash = ?, state_version = state_version + 1
     WHERE id = ? AND claim_token_hash IS NULL`,
    [claimTokenHash, observationId],
  );
  return result.affectedRows;
}

async function findObservationById(connection, observationId) {
  const [rows] = await connection.execute(
    `SELECT id, viewer_account_id, claim_token_hash, vendor_id, session_id, location_version_id,
            event_at_ms, source, event_public_status
     FROM cb_feedback_observation WHERE id = ? LIMIT 1`,
    [observationId],
  );
  return rows[0] || null;
}

/** 回放投影：观察行 + 生效资料摘要，避免为了拼名称再跨域读资料。 */
async function findObservationForReload(connection, observationId) {
  const [rows] = await connection.execute(
    `SELECT o.id, o.viewer_account_id, o.vendor_id, o.session_id, o.location_version_id,
            o.event_at_ms, o.source, o.event_public_status,
            p.vendor_name, p.category_code
     FROM cb_feedback_observation o
     LEFT JOIN cb_vendor_profile_version p ON p.id = (
       SELECT v.active_profile_version_id FROM cb_vendor_identity v WHERE v.id = o.vendor_id
     )
     WHERE o.id = ? LIMIT 1`,
    [observationId],
  );
  return rows[0] || null;
}

async function insertNavigationCheck(connection, {
  observationId, anonymousSessionHash, sessionId, locationVersionId, decision, createdAtMs, expiresAtMs,
}) {
  const [result] = await connection.execute(
    `INSERT INTO cb_navigation_check
       (observation_id, anonymous_session_hash, session_id, location_version_id,
        decision, created_at_ms, expires_at_ms, state_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [observationId, anonymousSessionHash, sessionId, locationVersionId, decision, createdAtMs, expiresAtMs],
  );
  return Number(result.insertId);
}

async function findNavigationCheckById(connection, checkId) {
  const [rows] = await connection.execute(
    `SELECT id, observation_id, anonymous_session_hash, session_id, location_version_id,
            decision, created_at_ms, expires_at_ms, launched_at_ms, launch_ref
     FROM cb_navigation_check WHERE id = ? LIMIT 1`,
    [checkId],
  );
  return rows[0] || null;
}

async function findNavigationCheckForUpdate(connection, checkId) {
  const [rows] = await connection.execute(
    `SELECT id, observation_id, anonymous_session_hash, session_id, location_version_id,
            decision, created_at_ms, expires_at_ms, launched_at_ms, launch_ref
     FROM cb_navigation_check WHERE id = ? FOR UPDATE`,
    [checkId],
  );
  return rows[0] || null;
}

/** 复核回放需要原始轮次计划结束时刻，计划结束时刻不随位置刷新变化。 */
async function findNavigationView(connection, checkId) {
  const [rows] = await connection.execute(
    `SELECT n.id, n.observation_id, n.session_id, n.location_version_id, n.decision,
            n.created_at_ms, n.expires_at_ms, n.launched_at_ms, n.launch_ref,
            s.planned_end_at_ms
     FROM cb_navigation_check n
     LEFT JOIN cb_vendor_session s ON s.id = n.session_id
     WHERE n.id = ? LIMIT 1`,
    [checkId],
  );
  return rows[0] || null;
}

async function markNavigationCheckLaunched(connection, { checkId, launchedAtMs, launchRef }) {
  const [result] = await connection.execute(
    `UPDATE cb_navigation_check
     SET launched_at_ms = ?, launch_ref = ?, state_version = state_version + 1
     WHERE id = ? AND launched_at_ms IS NULL`,
    [launchedAtMs, launchRef, checkId],
  );
  return result.affectedRows;
}

module.exports = {
  readNowMs,
  countPublicRows,
  listPublicRows,
  findPublicRowById,
  insertObservation,
  markObservationClaim,
  findObservationById,
  findObservationForReload,
  insertNavigationCheck,
  findNavigationCheckById,
  findNavigationCheckForUpdate,
  findNavigationView,
  markNavigationCheckLaunched,
};

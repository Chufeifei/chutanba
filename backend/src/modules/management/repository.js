/**
 * 管理域 SQL：角色、待办计数、摊主检索、当前轮次与管理处理记录。
 * 只读投影不复制业务判定；写库只有 insertAction 一条（cb_management_action）。
 */
const ACTION_COLUMNS = `a.id, a.action_type, a.vendor_id, a.target_session_id, a.source_case_id,
  a.reason, a.actor_account_id, a.effective_at_ms`;

async function findActiveRoleCodes(connection, accountId) {
  const [rows] = await connection.execute(
    "SELECT role_code FROM cb_user_role WHERE account_id = ? AND status = 'ACTIVE' ORDER BY role_code",
    [accountId],
  );
  return rows.map((row) => row.role_code);
}

async function countPendingProfileReviews(connection) {
  const [rows] = await connection.execute(
    "SELECT COUNT(*) AS n FROM cb_vendor_profile_version WHERE review_status = 'PENDING'",
  );
  return Number(rows[0].n);
}

async function countPendingFeedbackCases(connection) {
  const [rows] = await connection.execute(
    "SELECT COUNT(*) AS n FROM cb_feedback_case WHERE status = 'PENDING'",
  );
  return Number(rows[0].n);
}

async function countPendingImpactReviews(connection) {
  const [rows] = await connection.execute(
    "SELECT COUNT(*) AS n FROM cb_vendor_impact_review_request WHERE status = 'PENDING'",
  );
  return Number(rows[0].n);
}

/** LIKE 通配符按字面匹配：管理搜索不得因 % 或 _ 变成全表扫描。 */
function likeKeyword(keyword) {
  return `%${keyword.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

async function searchVendors(connection, { keyword, cursor, limit }) {
  const params = [];
  const clauses = ['v.lifecycle_status <> ?'];
  params.push('DELETED');
  if (cursor !== null) {
    clauses.push('v.id > ?');
    params.push(cursor);
  }
  if (keyword !== null) {
    clauses.push("(v.vendor_code LIKE ? ESCAPE '\\\\' OR p.vendor_name LIKE ? ESCAPE '\\\\')");
    const pattern = likeKeyword(keyword);
    params.push(pattern, pattern);
  }
  const [rows] = await connection.execute(
    `SELECT v.id, v.vendor_code, v.lifecycle_status, v.active_profile_version_id, p.vendor_name,
            p.category_code, c.governance_paused_at_ms
     FROM cb_vendor_identity v
     LEFT JOIN cb_vendor_profile_version p ON p.id = v.active_profile_version_id
     LEFT JOIN cb_vendor_publication_control c ON c.vendor_id = v.id
     WHERE ${clauses.join(' AND ')}
     ORDER BY v.id ASC
     LIMIT ${Number(limit) + 1}`,
    params,
  );
  return rows;
}

async function findVendorById(connection, vendorId) {
  const [rows] = await connection.execute(
    `SELECT v.id, v.vendor_code, v.lifecycle_status, v.active_profile_version_id,
            v.current_session_id, v.state_version, p.vendor_name, p.category_code
     FROM cb_vendor_identity v
     LEFT JOIN cb_vendor_profile_version p ON p.id = v.active_profile_version_id
     WHERE v.id = ?`,
    [vendorId],
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

async function findRecentActions(connection, { vendorId, limit }) {
  const [rows] = await connection.execute(
    `SELECT ${ACTION_COLUMNS} FROM cb_management_action a
     WHERE a.vendor_id = ?
     ORDER BY a.effective_at_ms DESC, a.id DESC
     LIMIT ${Number(limit)}`,
    [vendorId],
  );
  return rows;
}

async function findLatestAction(connection, { vendorId, actionType }) {
  const [rows] = await connection.execute(
    `SELECT ${ACTION_COLUMNS} FROM cb_management_action a
     WHERE a.vendor_id = ? AND a.action_type = ?
     ORDER BY a.id DESC LIMIT 1`,
    [vendorId, actionType],
  );
  return rows[0] || null;
}

async function findActionById(connection, actionId) {
  const [rows] = await connection.execute(
    `SELECT ${ACTION_COLUMNS} FROM cb_management_action a WHERE a.id = ?`,
    [actionId],
  );
  return rows[0] || null;
}

/** 纠错回放：按目标轮次找最近一条同类处理记录。 */
async function findLatestActionByTarget(connection, { targetSessionId, actionType }) {
  const [rows] = await connection.execute(
    `SELECT ${ACTION_COLUMNS} FROM cb_management_action a
     WHERE a.target_session_id = ? AND a.action_type = ?
     ORDER BY a.id DESC LIMIT 1`,
    [targetSessionId, actionType],
  );
  return rows[0] || null;
}

async function insertAction(connection, {
  actionType, vendorId, targetSessionId, sourceCaseId, reason, evidenceSummary,
  actorAccountId, effectiveAtMs,
}) {
  const [result] = await connection.execute(
    `INSERT INTO cb_management_action
       (action_type, vendor_id, target_session_id, source_case_id, reason, evidence_summary,
        actor_account_id, effective_at_ms, state_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [actionType, vendorId, targetSessionId, sourceCaseId, reason, evidenceSummary, actorAccountId, effectiveAtMs],
  );
  return Number(result.insertId);
}

/**
 * 摊主的管理处理记录数量与最近一次生效时刻：
 * 管理与治理审计按事件发生后 1095 个自然日保留，清除预览要按它给出到期时间。
 */
async function countActionsByVendor(connection, vendorId) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS total, MAX(effective_at_ms) AS latest_at_ms FROM cb_management_action WHERE vendor_id = ?',
    [vendorId],
  );
  return {
    count: Number(rows[0].total),
    latestAtMs: rows[0].latest_at_ms === null ? null : Number(rows[0].latest_at_ms),
  };
}

module.exports = {
  findActiveRoleCodes,
  countPendingProfileReviews,
  countPendingFeedbackCases,
  countPendingImpactReviews,
  countActionsByVendor,
  searchVendors,
  findVendorById,
  findSession,
  findRecentActions,
  findLatestAction,
  findActionById,
  findLatestActionByTarget,
  insertAction,
};

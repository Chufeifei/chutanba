/**
 * 观察域只读与领取写入的 SQL 集合。
 * 只写 SQL：不出现事务控制，不跨模块 require；调用方必须传入本次事务的连接。
 */

const OBSERVATION_COLUMNS = `o.id, o.viewer_account_id, o.version, o.vendor_id, o.session_id,
  o.location_version_id, o.event_at_ms, o.source, o.event_public_status`;

/** 领取按令牌摘要定位：库中只存摘要，明文令牌不落库。 */
async function findByClaimHashForUpdate(connection, tokenHash) {
  const [rows] = await connection.execute(
    `SELECT ${OBSERVATION_COLUMNS} FROM cb_feedback_observation o
     WHERE o.claim_token_hash = ? FOR UPDATE`,
    [tokenHash],
  );
  return rows[0] || null;
}

async function findByIdForUpdate(connection, observationId) {
  const [rows] = await connection.execute(
    `SELECT ${OBSERVATION_COLUMNS} FROM cb_feedback_observation o WHERE o.id = ? FOR UPDATE`,
    [observationId],
  );
  return rows[0] || null;
}

/**
 * 一次性绑定：条件更新同时要求「令牌仍是这一条」且「尚未被任何账号领取」，
 * 并发或重复领取时受影响行数为 0，由 service 转成冲突语义。
 *
 * 令牌摘要**保留不清空**：只有留着摘要，另一个账号再用同一令牌时才能判定为
 * 「已被他人领取」并返回 STATE_CONFLICT（契约 §5.3）；绑定条件本身已保证不可二次绑定。
 */
async function claimObservation(connection, { observationId, accountId, tokenHash }) {
  const [result] = await connection.execute(
    `UPDATE cb_feedback_observation
     SET viewer_account_id = ?, state_version = state_version + 1
     WHERE id = ? AND claim_token_hash = ? AND viewer_account_id IS NULL`,
    [accountId, observationId, tokenHash],
  );
  return result.affectedRows;
}

/** 领取结果读模型：摊主名称取轮次绑定的资料版本，避免读到待审内容。 */
async function findClaimView(connection, observationId) {
  const [rows] = await connection.execute(
    `SELECT o.id, o.event_at_ms, o.vendor_id, p.vendor_name, p.category_code
     FROM cb_feedback_observation o
     JOIN cb_vendor_session s ON s.id = o.session_id
     LEFT JOIN cb_vendor_profile_version p ON p.id = s.profile_version_id
     WHERE o.id = ?`,
    [observationId],
  );
  return rows[0] || null;
}

/** 候选分页：按事件时间与 ID 倒序；窗口过滤在 service 用同一判定函数完成。 */
async function listCandidates(connection, { accountId, cursor, limit }) {
  const params = [accountId];
  let cursorClause = '';
  if (cursor) {
    cursorClause = 'AND (o.event_at_ms < ? OR (o.event_at_ms = ? AND o.id < ?))';
    params.push(cursor.eventAtMs, cursor.eventAtMs, cursor.observationId);
  }
  // 预编译语句不接受 LIMIT ?：上限已在 schema 校验为 1～50 的整数，直接内联。
  const pageSize = Number(limit) + 1;
  const [rows] = await connection.execute(
    `SELECT ${OBSERVATION_COLUMNS}, s.ended_at_ms, s.planned_end_at_ms,
            p.vendor_name, p.category_code,
            (SELECT GROUP_CONCAT(f.feedback_type ORDER BY f.feedback_type)
               FROM cb_feedback_fact f
              WHERE f.observation_id = o.id AND f.reporter_account_id = o.viewer_account_id) AS submitted_types
     FROM cb_feedback_observation o
     JOIN cb_vendor_session s ON s.id = o.session_id
     LEFT JOIN cb_vendor_profile_version p ON p.id = s.profile_version_id
     WHERE o.viewer_account_id = ? ${cursorClause}
     ORDER BY o.event_at_ms DESC, o.id DESC
     LIMIT ${pageSize}`,
    params,
  );
  return rows;
}

/** 原轮次事实：反馈窗口只看观察发生时的那一轮，不看摊主当前轮次。 */
async function findSessionById(connection, sessionId) {
  const [rows] = await connection.execute(
    'SELECT id, vendor_id, ended_at_ms, planned_end_at_ms FROM cb_vendor_session WHERE id = ?',
    [sessionId],
  );
  return rows[0] || null;
}

/** 原位置版本：位置被替换后该行仍保留自身停止时刻，是核距离的唯一事实来源。 */
async function findLocationById(connection, locationId) {
  const [rows] = await connection.execute(
    'SELECT id, session_id, vendor_id, version_no, lat, lng, stopped_at_ms FROM cb_session_location WHERE id = ?',
    [locationId],
  );
  return rows[0] || null;
}

module.exports = {
  findByClaimHashForUpdate,
  findByIdForUpdate,
  claimObservation,
  findClaimView,
  listCandidates,
  findSessionById,
  findLocationById,
};

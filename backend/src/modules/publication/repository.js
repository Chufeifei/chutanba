/**
 * 公开控制唯一写库方：只做数据存取，不开事务、不判断业务。
 * 控制行懒创建：本人与治理共用一个 row，但两组列与两个版本互不影响。
 */
const CONTROL_COLUMNS = `id, vendor_id, self_stopped_at_ms, self_version,
  governance_paused_at_ms, governance_version, state_version`;

async function findByVendor(connection, vendorId) {
  const [rows] = await connection.execute(
    `SELECT ${CONTROL_COLUMNS} FROM cb_vendor_publication_control WHERE vendor_id = ? LIMIT 1`,
    [vendorId],
  );
  return rows[0] || null;
}

async function findVendorByAccount(connection, accountId) {
  const [rows] = await connection.execute(
    'SELECT id, lifecycle_status, active_profile_version_id, state_version FROM cb_vendor_identity WHERE active_account_id = ? LIMIT 1',
    [accountId],
  );
  return rows[0] || null;
}

/**
 * 懒创建后立即加锁：并发首次写入由 uq_publication_vendor 兜底，
 * state_version 取摊主当前值，避免控制行版本与摊主版本脱节。
 */
async function ensureForUpdate(connection, { vendorId, vendorStateVersion }) {
  await connection.execute(
    `INSERT INTO cb_vendor_publication_control
       (vendor_id, self_version, governance_version, state_version)
     VALUES (?, 1, 1, ?)
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [vendorId, vendorStateVersion],
  );
  const [rows] = await connection.execute(
    `SELECT ${CONTROL_COLUMNS} FROM cb_vendor_publication_control WHERE vendor_id = ? FOR UPDATE`,
    [vendorId],
  );
  return rows[0] || null;
}

async function updateSelfStopped(connection, { controlId, expectedSelfVersion, stoppedAtMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_publication_control
     SET self_stopped_at_ms = ?, self_version = self_version + 1, state_version = state_version + 1
     WHERE id = ? AND self_version = ?`,
    [stoppedAtMs, controlId, expectedSelfVersion],
  );
  return result.affectedRows;
}

async function updateSelfResumed(connection, { controlId, expectedSelfVersion }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_publication_control
     SET self_stopped_at_ms = NULL, self_version = self_version + 1, state_version = state_version + 1
     WHERE id = ? AND self_version = ? AND self_stopped_at_ms IS NOT NULL`,
    [controlId, expectedSelfVersion],
  );
  return result.affectedRows;
}

async function updateGovernancePaused(connection, { controlId, expectedGovernanceVersion, pausedAtMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_publication_control
     SET governance_paused_at_ms = ?, governance_version = governance_version + 1,
         state_version = state_version + 1
     WHERE id = ? AND governance_version = ?`,
    [pausedAtMs, controlId, expectedGovernanceVersion],
  );
  return result.affectedRows;
}

async function updateGovernanceRestored(connection, { controlId, expectedGovernanceVersion }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_publication_control
     SET governance_paused_at_ms = NULL, governance_version = governance_version + 1,
         state_version = state_version + 1
     WHERE id = ? AND governance_version = ? AND governance_paused_at_ms IS NOT NULL`,
    [controlId, expectedGovernanceVersion],
  );
  return result.affectedRows;
}

module.exports = {
  findByVendor,
  findVendorByAccount,
  ensureForUpdate,
  updateSelfStopped,
  updateSelfResumed,
  updateGovernancePaused,
  updateGovernanceRestored,
};

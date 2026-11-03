/**
 * 资料域的清除相关写库方：只写 SQL，不开事务、不做业务判断。
 * 与资料域其余写库方拆文件存放，为守住单文件 250 行上限；
 * 事务连接仍由 service 通过 withTransaction 统一传入。
 */

/** 清空生效资料指针：清除请求成立后公开投影立即读不到已申请清除的公开值。 */
async function clearActiveProfileVersion(connection, { vendorId, nowMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_identity
     SET active_profile_version_id = NULL, state_version = state_version + 1, updated_at_ms = ?
     WHERE id = ?`,
    [nowMs, vendorId],
  );
  return result.affectedRows;
}

/** 冻结相交待审申请：置 INVALIDATED 后不能再被批准并恢复公开。 */
async function invalidatePendingVersions(connection, { vendorId, decidedAtMs }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_profile_version
     SET review_status = 'INVALIDATED', decided_at_ms = ?, task_version = task_version + 1,
         state_version = state_version + 1
     WHERE vendor_id = ? AND review_status = 'PENDING'`,
    [decidedAtMs, vendorId],
  );
  return result.affectedRows;
}

/**
 * 去标识化资料内容：保留版本行与审核痕迹（最小墓碑），只把可清除的完整值换成墓碑值。
 * 已是墓碑值的行不再改写，保证清理批次可重复执行。
 */
async function deidentifyVersions(connection, { vendorId, vendorName, categoryCode }) {
  const [result] = await connection.execute(
    `UPDATE cb_vendor_profile_version
     SET vendor_name = ?, category_code = ?, regular_items_text = '', price_description = '',
         announcement = '', state_version = state_version + 1
     WHERE vendor_id = ? AND (vendor_name <> ? OR category_code <> ? OR regular_items_text <> ''
           OR price_description <> '' OR announcement <> '')`,
    [vendorName, categoryCode, vendorId, vendorName, categoryCode],
  );
  return result.affectedRows;
}

/** 待审申请数量：预览要说明清除会冻结几份待审资料。 */
async function countPendingVersions(connection, { vendorId }) {
  const [rows] = await connection.execute(
    "SELECT COUNT(*) AS total FROM cb_vendor_profile_version WHERE vendor_id = ? AND review_status = 'PENDING'",
    [vendorId],
  );
  return Number(rows[0].total);
}

module.exports = {
  clearActiveProfileVersion, invalidatePendingVersions, deidentifyVersions, countPendingVersions,
};

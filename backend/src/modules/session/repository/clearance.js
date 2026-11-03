/**
 * 营业域的清除相关写库方：只写 SQL，不开事务、不做业务判断。
 * 与营业域其余写库方拆文件存放，为守住单文件 250 行上限；
 * 事务连接仍由 service 通过 withTransaction 统一传入。
 */
const LOCATION_COLUMNS = `id, session_id, vendor_id, version_no, lat, lng, location_name, located_at_ms,
  effective_at_ms, stopped_at_ms, stop_reason, state_version`;

/**
 * 摊主的全部位置版本（含已停止）：保留期按每个版本自身的停止时刻计算，清除时逐版本去标识化。
 */
async function listVendorLocations(connection, { vendorId }) {
  const [rows] = await connection.execute(
    `SELECT ${LOCATION_COLUMNS} FROM cb_session_location WHERE vendor_id = ? ORDER BY id ASC`,
    [vendorId],
  );
  return rows;
}

/**
 * 去标识化坐标：保留位置行与停止时刻（最小墓碑），只把坐标与位置名换成墓碑值。
 * 只处理指定的位置版本——被保留挂起或延期未到的位置不在清单里，保持原值。
 * 已是墓碑值的行不再改写，保证清理批次可重复执行；该行永远不可公开（指针已清、停止时刻非空）。
 */
async function deidentifyVendorLocations(connection, { vendorId, locationName, locationIds }) {
  const ids = (locationIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return 0;
  // 目标 ID 数量不定时按批取：动态部分只有占位符个数，取值仍全部走参数化。
  let affected = 0;
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    const placeholders = chunk.map(() => '?').join(',');
    const [result] = await connection.execute(
      `UPDATE cb_session_location
       SET lat = 0, lng = 0, location_name = ?, state_version = state_version + 1
       WHERE vendor_id = ? AND id IN (${placeholders})
         AND (lat <> 0 OR lng <> 0 OR location_name <> ?)`,
      [locationName, vendorId, ...chunk, locationName],
    );
    affected += result.affectedRows;
  }
  return affected;
}

module.exports = { listVendorLocations, deidentifyVendorLocations };

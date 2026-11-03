/**
 * 公开资格谓词（唯一实现）。
 * 口径见 doc/MVP/一期数据模型与接口约定.md §4：有审核生效资料 ∧ 本人未停止 ∧ 治理未暂停
 * ∧ 存在当前轮次 ∧ S ≤ N < E ∧ 当前轮有效位置。列表、详情、观察与导航复核都必须调用这里，
 * 不允许端点各自再写一套「是否营业」判断。
 */
function hasValue(value) {
  return value !== null && value !== undefined;
}

/**
 * 三态判定：OPEN = 可查看且纳入公开集合；RESTING = 资料可公开但当前无有效出摊；
 * UNVIEWABLE = 资料缺失、被本人停止或治理暂停、或摊位不存在。
 */
function describeAvailability(row, nowMs) {
  if (!row) return 'UNVIEWABLE';
  if (row.lifecycle_status && row.lifecycle_status !== 'ACTIVE') return 'UNVIEWABLE';
  if (!hasValue(row.active_profile_version_id)) return 'UNVIEWABLE';
  if (hasValue(row.self_stopped_at_ms) || hasValue(row.governance_paused_at_ms)) return 'UNVIEWABLE';
  if (!hasValue(row.session_id)) return 'RESTING';
  if (!Number.isSafeInteger(nowMs)) throw new TypeError('nowMs 必须是毫秒安全整数');
  // 到期未物理结束（E <= N）也按休息处理，不能把过期轮次当作在营业。
  if (nowMs < Number(row.started_at_ms) || nowMs >= Number(row.planned_end_at_ms)) return 'RESTING';
  if (!hasValue(row.location_id) || hasValue(row.stopped_at_ms)) return 'RESTING';
  return 'OPEN';
}

function isPubliclyVisible(row, nowMs) {
  return describeAvailability(row, nowMs) === 'OPEN';
}

module.exports = { describeAvailability, isPubliclyVisible };

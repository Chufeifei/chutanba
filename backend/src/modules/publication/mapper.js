/**
 * 公开控制行 → 对外结构。
 * 控制行可缺省：缺省时按契约给出 selfVersion/governanceVersion = 1 的默认值，
 * 两列分别返回，不做“合并开关”。
 */
const DEFAULT_VERSION = 1;

function toControls(row) {
  if (!row) {
    return {
      selfStoppedAtMs: null,
      selfVersion: DEFAULT_VERSION,
      governancePausedAtMs: null,
      governanceVersion: DEFAULT_VERSION,
    };
  }
  return {
    selfStoppedAtMs: row.self_stopped_at_ms === null ? null : Number(row.self_stopped_at_ms),
    selfVersion: Number(row.self_version),
    governancePausedAtMs: row.governance_paused_at_ms === null ? null : Number(row.governance_paused_at_ms),
    governanceVersion: Number(row.governance_version),
  };
}

function toSelfPublication({ vendor, row }) {
  return {
    ...toControls(row),
    stateVersion: Number(vendor.state_version),
    activeProfileAvailable: vendor.active_profile_version_id !== null
      && vendor.active_profile_version_id !== undefined,
  };
}

/** /me 只增补受限时刻：未受限时字段完全缺失，避免客户端误判为“曾经受限”。 */
function toSelfContext(row) {
  const controls = toControls(row);
  const context = {};
  if (controls.selfStoppedAtMs !== null) context.selfStoppedAtMs = controls.selfStoppedAtMs;
  if (controls.governancePausedAtMs !== null) context.governancePausedAtMs = controls.governancePausedAtMs;
  return context;
}

module.exports = { toControls, toSelfPublication, toSelfContext, DEFAULT_VERSION };

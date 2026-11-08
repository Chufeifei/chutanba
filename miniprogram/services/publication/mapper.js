/**
 * 公开控制读模型（P11）。
 *
 * 两类限制必须分别成立、分别展示：
 * - self：本人停止公开（本人可撤销）；
 * - governance：治理暂停（本人不可撤销，页面不给操作）。
 * 任何"合并开关"都是在暗示解除其中一个会连带解除另一个，属于需求 O-03 的违例。
 */
const { formatMoment } = require('../../utils/formatter');
const { PROFILE_STATE, PROFILE_STATE_LABEL } = require('../../config/contracts');

const UNKNOWN_PROFILE_TEXT = '暂时无法读取资料状态';

function toSelfSection({ stopped, stoppedAtMs, activeProfileAvailable }) {
  return {
    stopped,
    statusText: stopped ? '你已停止公开' : '你正在公开',
    stoppedText: stopped ? formatMoment(stoppedAtMs) : '',
    hint: stopped
      ? '摊位暂不展示'
      : '摊位展示中',
    actionText: stopped ? '恢复公开' : '停止公开',
    // 停止任何时候都可点；恢复需要已生效资料，否则服务端会 PROFILE_REQUIRED
    canStop: !stopped,
    canResume: stopped && activeProfileAvailable,
    resumeBlockedText: stopped && !activeProfileAvailable
      ? '请先补齐资料'
      : '',
  };
}

function toGovernanceSection({ paused, pausedAtMs }) {
  return {
    paused,
    statusText: paused ? '当前处于治理暂停' : '没有治理限制',
    pausedText: paused ? formatMoment(pausedAtMs) : '',
    hint: '治理限制由管理处理',
  };
}

function toProfileSection(profileModel) {
  if (!profileModel) {
    return { available: false, stateLabel: UNKNOWN_PROFILE_TEXT, needsProfile: false, hint: '' };
  }
  const state = profileModel.profileState || PROFILE_STATE.NONE;
  return {
    available: true,
    profileState: state,
    stateLabel: PROFILE_STATE_LABEL[state] || PROFILE_STATE_LABEL[PROFILE_STATE.NONE],
    // 只有 ACTIVE 才算"有生效资料"；其余状态都要先补齐并过审
    needsProfile: state !== PROFILE_STATE.ACTIVE,
    hint: state === PROFILE_STATE.ACTIVE ? '' : '资料未生效',
  };
}

/**
 * @param {object} raw GET /vendor/publication 的 data
 * @param {object|null} profileModel services/profile 的读模型（可缺省）
 */
function toPublicationModel(raw, profileModel) {
  const source = raw || {};
  const selfStoppedAtMs = source.selfStoppedAtMs === null || source.selfStoppedAtMs === undefined
    ? null : Number(source.selfStoppedAtMs);
  const governancePausedAtMs = source.governancePausedAtMs === null
    || source.governancePausedAtMs === undefined
    ? null : Number(source.governancePausedAtMs);
  const stopped = selfStoppedAtMs !== null;
  const paused = governancePausedAtMs !== null;

  return {
    // 版本基准：写命令的 expectedSelfVersion 取这里，不要自己算
    selfVersion: Number(source.selfVersion) || 1,
    governanceVersion: Number(source.governanceVersion) || 1,
    stateVersion: Number(source.stateVersion) || 0,
    activeProfileAvailable: Boolean(source.activeProfileAvailable),
    self: toSelfSection({ stopped, stoppedAtMs: selfStoppedAtMs, activeProfileAvailable: Boolean(source.activeProfileAvailable) }),
    governance: toGovernanceSection({ paused, pausedAtMs: governancePausedAtMs }),
    profile: toProfileSection(profileModel),
    // 两项同时生效时必须明说它们不会互相解除
    bothLimitedText: stopped && paused
      ? '两项限制同时生效'
      : '',
  };
}

module.exports = { UNKNOWN_PROFILE_TEXT, toPublicationModel };

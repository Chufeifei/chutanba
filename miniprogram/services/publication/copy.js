/**
 * P11 的动作与确认文案。
 *
 * 两类限制独立：停止/恢复只碰本人选择，文案里绝不能出现「同时解除治理」这类暗示。
 */
const ACTION = Object.freeze({
  STOP: 'stop',
  RESUME: 'resume',
});

const CONFIRM_COPY = Object.freeze({
  [ACTION.STOP]: {
    title: '停止公开',
    description: [
      '停止后立即结束当前营业轮次，隐藏你的资料与位置，并禁止再开摊。',
      '该操作即时生效，不需要管理员受理，也不记为违规。',
    ].join(''),
    confirmText: '确认停止公开',
  },
  [ACTION.RESUME]: {
    title: '恢复公开',
    description: [
      '只解除你本人的停止选择。',
      '治理暂停仍然有效，不会自动开摊，也不会恢复停止前的位置。',
    ].join(''),
    confirmText: '确认恢复公开',
  },
});

const SUCCESS_TIP = Object.freeze({
  [ACTION.STOP]: '已停止公开',
  [ACTION.RESUME]: '已恢复公开',
});

function confirmCopy(action) {
  return CONFIRM_COPY[action] || CONFIRM_COPY[ACTION.STOP];
}

function successTip(action) {
  return SUCCESS_TIP[action] || '已更新';
}

module.exports = { ACTION, confirmCopy, successTip };

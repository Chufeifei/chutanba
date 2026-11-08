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
      '确认停止公开？',
      '',
    ].join(''),
    confirmText: '确认停止公开',
  },
  [ACTION.RESUME]: {
    title: '恢复公开',
    description: [
      '确认恢复公开？',
      '',
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

/**
 * 摊主工作台的文案（P09）。
 *
 * 单独成文件的原因：确认弹层与提示语是纯文案，不该和接口编排挤在一个入口文件里，
 * 也不该散落到页面上各写一份。
 */
const DEFAULT_LOCATION_NAME = '我的摊位位置';

const ACTION = Object.freeze({ OPEN: 'open', REFRESH: 'refresh', CLOSE: 'close' });

/** 确认弹层文案。位置与截止时间都要摊主再确认一次，服务端默认值不能静默生效。 */
function confirmCopy(action, params = {}) {
  const name = params.locationName || DEFAULT_LOCATION_NAME;
  if (action === ACTION.OPEN) {
    return {
      title: '确认开摊',
      description: `${params.cutoffText || ''} 收摊 · ${name}`,
      confirmText: '确认开摊',
    };
  }
  if (action === ACTION.REFRESH) {
    return {
      title: '确认刷新位置',
      description: `刷新位置：${name}`,
      confirmText: '确认刷新',
    };
  }
  return {
    title: '确认收摊',
    description: '确认收摊',
    confirmText: '确认收摊',
  };
}

/** 动作成功后的提示文案。 */
function successTip(action) {
  if (action === ACTION.OPEN) return '已开摊';
  if (action === ACTION.REFRESH) return '位置已更新';
  return '已收摊';
}

module.exports = { ACTION, DEFAULT_LOCATION_NAME, confirmCopy, successTip };

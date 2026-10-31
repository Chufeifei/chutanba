const STORAGE_KEY = 'mvp.pendingAction';
const MAX_AGE_MS = 10 * 60 * 1000;

function rememberAction(action) {
  if (!action || typeof action.route !== 'string' || !action.route.startsWith('/pages/')) {
    throw new TypeError('待恢复动作必须包含有效页面路由');
  }
  const value = { type: String(action.type || 'NAVIGATE'), route: action.route, params: action.params || {}, createdAtMs: Date.now() };
  wx.setStorageSync(STORAGE_KEY, value);
  return value;
}

function clearAction() {
  wx.removeStorageSync(STORAGE_KEY);
}

function peekAction() {
  const value = wx.getStorageSync(STORAGE_KEY);
  if (!value || !value.route || Date.now() - Number(value.createdAtMs || 0) > MAX_AGE_MS) {
    clearAction();
    return null;
  }
  return value;
}

function consumeAction() {
  const value = peekAction();
  if (value) clearAction();
  return value;
}

function actionUrl(action) {
  const params = { ...(action.params || {}), resumeAction: action.type };
  const query = Object.entries(params)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return query ? `${action.route}?${query}` : action.route;
}

function resumePendingAction() {
  const action = consumeAction();
  if (!action) return false;
  wx.navigateTo({ url: actionUrl(action) });
  return true;
}

module.exports = { STORAGE_KEY, rememberAction, clearAction, peekAction, consumeAction, actionUrl, resumePendingAction };

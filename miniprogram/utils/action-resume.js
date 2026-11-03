/**
 * 待恢复动作：记录"用户本来要做什么"，在授权或登录恢复后继续。
 *
 * 与原版的区别（技术设计 §4.3 明确要求收窄）：
 * 原实现会原样保存调用方传入的任意 params，可能把精确坐标、管理证据、
 * 完整资料表单一起落盘。这里改成只允许短标量、且拒绝敏感键。
 *
 * 定位：这是 UI 层的跳转恢复，不是业务凭据。
 * 真正的"写操作未完成"恢复由 utils/action-key.js + services/submission 负责。
 */
const STORAGE_KEY = 'mvp.pendingAction';
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_PARAM_LENGTH = 64;

// 这些键一旦落盘就是个人信息副本，一律拒绝
const FORBIDDEN_PARAM_KEY = /^(lat|lng|latitude|longitude|location|currentlocation|locationcontexttoken|claimtoken|token|evidence|description|reason|phone|openid)$/i;

function sanitizeParams(params) {
  const source = params && typeof params === 'object' ? params : {};
  const result = {};
  Object.entries(source).forEach(([key, value]) => {
    if (FORBIDDEN_PARAM_KEY.test(key)) return;
    if (value == null || value === '') return;
    if (typeof value === 'boolean' || typeof value === 'number') {
      result[key] = value;
      return;
    }
    if (typeof value === 'string' && value.length <= MAX_PARAM_LENGTH) {
      result[key] = value;
    }
  });
  return result;
}

function rememberAction(action) {
  if (!action || typeof action.route !== 'string' || !action.route.startsWith('/pages/')) {
    throw new TypeError('待恢复动作必须包含有效页面路由');
  }
  const value = {
    type: String(action.type || 'NAVIGATE'),
    route: action.route,
    params: sanitizeParams(action.params),
    createdAtMs: Date.now(),
  };
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

module.exports = {
  STORAGE_KEY,
  sanitizeParams,
  rememberAction,
  clearAction,
  peekAction,
  consumeAction,
  actionUrl,
  resumePendingAction,
};

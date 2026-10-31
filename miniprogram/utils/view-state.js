const VIEW_STATE = Object.freeze({
  CONTENT: 'content',
  LOADING: 'loading',
  EMPTY: 'empty',
  PERMISSION: 'permission',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  TERMINAL: 'terminal',
  RETRYABLE_FAILURE: 'retryable-failure',
});

const DEFAULT_COPY = Object.freeze({
  [VIEW_STATE.LOADING]: { title: '正在加载', description: '请稍候' },
  [VIEW_STATE.EMPTY]: { title: '暂无内容', description: '可以稍后再来看看' },
  [VIEW_STATE.PERMISSION]: { title: '需要授权', description: '完成所需授权后可继续' },
  [VIEW_STATE.PROCESSING]: { title: '正在处理', description: '请勿重复提交' },
  [VIEW_STATE.SUCCESS]: { title: '处理成功', description: '结果已保存' },
  [VIEW_STATE.TERMINAL]: { title: '当前操作不可继续', description: '请返回查看最新状态' },
  [VIEW_STATE.RETRYABLE_FAILURE]: { title: '暂时未能完成', description: '请检查网络后重试', actionText: '重试' },
});

function createViewState(type = VIEW_STATE.CONTENT, overrides = {}) {
  if (!Object.values(VIEW_STATE).includes(type)) throw new TypeError(`未知页面状态：${type}`);
  return { type, ...(DEFAULT_COPY[type] || {}), actionText: '', ...overrides };
}

function viewStateFromError(error, overrides = {}) {
  if (error?.authenticationExpired || error?.permissionDenied) {
    return createViewState(VIEW_STATE.PERMISSION, {
      title: error.authenticationExpired ? '登录状态已失效' : '当前没有访问权限',
      description: error.message,
      actionText: error.authenticationExpired ? '重新登录' : '',
      ...overrides,
    });
  }
  if (error?.retryable) {
    return createViewState(VIEW_STATE.RETRYABLE_FAILURE, { description: error.message, ...overrides });
  }
  return createViewState(VIEW_STATE.TERMINAL, { description: error?.message || '请返回查看最新状态', ...overrides });
}

module.exports = { VIEW_STATE, createViewState, viewStateFromError };

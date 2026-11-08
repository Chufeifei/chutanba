/**
 * 页面可见状态机（依据 doc/MVP/一期技术设计.md §9）。
 *
 * 十个状态全部是"界面状态"，不承载业务资格判断 —— 资格永远由服务端返回。
 *
 * 关键区分（评审时最容易混的两组）：
 * - STALE ≠ RETRYABLE_ERROR：STALE 是"已经显示了内容，但无法确认现在是否仍然成立"，
 *   必须禁用依赖新鲜状态的导航与写动作；读失败是"还没拿到内容"。
 * - WRITE_UNKNOWN ≠ 写失败：请求超时只说明"不知道服务端成立没有"，
 *   必须按原操作键查询结果，不能显示失败并换键重发。
 *
 * 页面只渲染，不要自己判断该用哪个状态：错误一律经 utils/failure.js 的 toViewState 转换。
 */
const VIEW_STATE = Object.freeze({
  LOADING: 'loading',
  CONTENT: 'content',
  EMPTY: 'empty',
  STALE: 'stale',
  PERMISSION: 'permission',
  RETRYABLE_ERROR: 'retryable-error',
  TERMINAL_ERROR: 'terminal-error',
  WRITE_PENDING: 'write-pending',
  WRITE_UNKNOWN: 'write-unknown',
  CONFLICT: 'conflict',
});

const DEFAULT_COPY = Object.freeze({
  [VIEW_STATE.LOADING]: {
    title: '正在加载',
    description: '请稍候',
  },
  [VIEW_STATE.EMPTY]: {
    title: '暂无内容',
    description: '可以稍后再来看看',
  },
  [VIEW_STATE.STALE]: {
    title: '状态未更新',
    description: '暂时无法确认最新状态',
    actionText: '重新确认',
  },
  [VIEW_STATE.PERMISSION]: {
    title: '当前没有访问权限',
    description: '完成所需授权后可继续',
  },
  [VIEW_STATE.RETRYABLE_ERROR]: {
    title: '暂时未能完成',
    description: '请检查网络后重试',
    actionText: '重试',
  },
  [VIEW_STATE.TERMINAL_ERROR]: {
    title: '当前不可继续',
    description: '请返回查看最新状态',
  },
  [VIEW_STATE.WRITE_PENDING]: {
    title: '正在处理',
    description: '正在处理，请稍候',
  },
  [VIEW_STATE.WRITE_UNKNOWN]: {
    title: '结果待确认',
    description: '网络中断，尚不确定本次操作是否成立',
    actionText: '查看最新结果',
  },
  [VIEW_STATE.CONFLICT]: {
    title: '状态已变化',
    description: '请查看最新结果后重新操作',
    actionText: '查看最新结果',
  },
});

// 内容态由页面直接渲染列表／详情，其余状态交给 state-view 组件
const MESSAGE_STATES = Object.values(VIEW_STATE).filter((type) => type !== VIEW_STATE.CONTENT);

function createViewState(type = VIEW_STATE.CONTENT, overrides = {}) {
  if (!Object.values(VIEW_STATE).includes(type)) {
    throw new TypeError(`未知页面状态：${type}`);
  }
  // actionText 的兜底必须放在 DEFAULT_COPY 之前：放后面会把 stale / retryable-error
  // 自带的「重新确认」「重试」按钮清空，断网后用户只能退出重进
  return { actionText: '', type, ...(DEFAULT_COPY[type] || {}), ...overrides };
}

/** 只改文案不清状态，用于把服务端 msg 覆盖到当前状态上。 */
function withCopy(viewState, overrides = {}) {
  return { ...viewState, ...overrides };
}

function isContentViewState(viewState) {
  return Boolean(viewState) && viewState.type === VIEW_STATE.CONTENT;
}

/** 处于这些状态时不得发起依赖新鲜数据的动作（导航、开摊、审核等）。 */
function blocksFreshAction(viewState) {
  if (!viewState) return true;
  return [
    VIEW_STATE.STALE,
    VIEW_STATE.WRITE_UNKNOWN,
    VIEW_STATE.CONFLICT,
    VIEW_STATE.PERMISSION,
    VIEW_STATE.TERMINAL_ERROR,
  ].includes(viewState.type);
}

module.exports = {
  VIEW_STATE,
  MESSAGE_STATES,
  createViewState,
  withCopy,
  isContentViewState,
  blocksFreshAction,
};

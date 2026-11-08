/**
 * 分支态结构化定义（设计稿 17–23）与单一 failureKind 映射。
 *
 * 【当前未接线】本模块尚未被任何页面 require，页面仍各自维护 data 字段与
 * viewState。是否接线、何时接线留待终审裁决；本文件不改动任何页面。
 *
 * 【另路径方案】首版以可见文案的正则嗅探反推「定位失败」，文案一改就会静默
 * 失效；返工版改读 ApiError.data.locationFailure，但 non-finite 坐标错误不带
 * 该标识，边缘路径仍覆盖不到。本模块把「错误来源 → 状态」集中成一张归一化
 * 表：只读结构化字段，页面只读 kind，不再看任何用户可见文案。
 *
 * 【最小接入示例】仅示意，终审裁决前不执行、不接线：
 *   const states = require('../../mock/branch-states');
 *   const kind = states.resolveFailureKind(error);
 *   const meta = states.FAILURE_KIND[kind];
 *   const branch = states.getBranchByStateKey(meta.stateKey);
 *   this.setData({ kindLabel: meta.label, ...states.PREVIEW_DATA[branch.screen] });
 */

/** 7 个分支态。route 与 stateKey 均按 app.json / 页面 data 字段核对。 */
const BRANCH_STATES = [
  {
    screen: '17',
    route: 'pages/discover/index',
    stateKey: 'locationHint',
    trigger: '定位授权被拒',
    view: ['位置提示条', '授权引导卡', '重试入口'],
    primaryCta: '重新定位',
    secondaryCta: '返回首页',
    exit: '授权后重新加载',
  },
  {
    screen: '18',
    route: 'pages/discover/index',
    stateKey: 'viewState',
    trigger: '列表请求失败',
    view: ['整页状态卡', '重新加载按钮'],
    primaryCta: '重新加载',
    secondaryCta: '返回首页',
    exit: '加载成功',
  },
  {
    screen: '19',
    route: 'pages/vendor-detail/index',
    stateKey: 'navReviewFailure',
    trigger: '导航复核未过',
    view: ['复核提示条', '重新复核按钮', '返回详情'],
    primaryCta: '重新复核',
    secondaryCta: '返回详情',
    exit: '复核通过',
  },
  {
    screen: '20',
    route: 'pages/vendor-detail/index',
    stateKey: 'viewState',
    trigger: '当前不可查看',
    view: ['不可查看提示', '返回入口'],
    primaryCta: '返回上一页',
    secondaryCta: '返回首页',
    exit: '重新进入详情',
  },
  {
    screen: '21',
    route: 'pages/feedback-result/index',
    stateKey: 'fromSubmit',
    trigger: '反馈提交完成',
    view: ['成功提示', '结果卡', '返回详情'],
    primaryCta: '返回详情',
    secondaryCta: '返回首页',
    exit: '离开结果页',
  },
  {
    screen: '22',
    route: 'pages/vendor-profile/index',
    stateKey: 'hasPending',
    trigger: '资料审核中',
    view: ['审核状态条', '进度说明', '返回入口'],
    primaryCta: '查看进度',
    secondaryCta: '返回首页',
    exit: '审核结束',
  },
  {
    screen: '23',
    route: 'pages/feedback-form/index',
    stateKey: 'locationFailed',
    trigger: '定位未取得',
    view: ['定位失败提示', '重新定位按钮', '表单入口'],
    primaryCta: '重新定位',
    secondaryCta: '放弃反馈',
    exit: '定位成功回表单',
  },
];

/**
 * 单一 failureKind 映射表：kind → 展示元信息。
 * label 一律为 ≤8 字中性短状态，不写业务规则、不含阈值。
 * UNKNOWN 为兜底项，label 为中性短状态。
 */
const FAILURE_KIND = {
  LOCATION_DENIED: {
    kind: 'LOCATION_DENIED',
    label: '定位被拒',
    recoverable: true,
    suggestedAction: '去开启授权',
    stateKey: 'locationHint',
  },
  LOCATION_UNAVAILABLE: {
    kind: 'LOCATION_UNAVAILABLE',
    label: '定位暂不可用',
    recoverable: true,
    suggestedAction: '稍后重试',
    stateKey: 'locationHint',
  },
  LOCATION_INVALID: {
    kind: 'LOCATION_INVALID',
    label: '坐标无效',
    recoverable: true,
    suggestedAction: '重新定位',
    stateKey: 'locationFailed',
  },
  NETWORK_ERROR: {
    kind: 'NETWORK_ERROR',
    label: '网络中断',
    recoverable: true,
    suggestedAction: '重新加载',
    stateKey: 'viewState',
  },
  NAVIGATION_REVIEW_BLOCKED: {
    kind: 'NAVIGATION_REVIEW_BLOCKED',
    label: '复核未通过',
    recoverable: true,
    suggestedAction: '重新复核',
    stateKey: 'navReviewFailure',
  },
  PROFILE_REVIEW_PENDING: {
    kind: 'PROFILE_REVIEW_PENDING',
    label: '审核中',
    recoverable: false,
    suggestedAction: '查看进度',
    stateKey: 'hasPending',
  },
  FEEDBACK_SUBMIT_UNKNOWN: {
    kind: 'FEEDBACK_SUBMIT_UNKNOWN',
    label: '结果待确认',
    recoverable: true,
    suggestedAction: '查看结果',
    stateKey: 'fromSubmit',
  },
  UNKNOWN: {
    kind: 'UNKNOWN',
    label: '暂未分类',
    recoverable: true,
    suggestedAction: '返回重试',
    stateKey: 'viewState',
  },
};

/**
 * 单一归一化表：结构化来源值 → 标准 kind。
 * 逐条对应项目既有结构化字段，resolveFailureKind 只查这一张表。
 *   LOCATION_*          utils/location.js 的 data.locationFailure
 *   LOCATION_INVALID    config/contracts 的 BIZ_CODE.LOCATION_INVALID
 *   NOT_NAVIGABLE       config/contracts 的 BIZ_CODE.NOT_NAVIGABLE
 *   BLOCKED             services/navigation 的 result.kind
 *   retryable           utils/failure 的 ERROR_CATEGORY.RETRYABLE
 *   unknown             utils/failure 的 WRITE_OUTCOME.UNKNOWN
 * 其余键为标准 kind 直传（data.kind / code 直接给标准 kind 时命中）。
 * name 恒为 'ApiError'、category 为粗分类，二者不携带分支语义，故未登记，
 * 不会据名猜状态。non-finite 坐标错误若上游补挂 data.kind 即可命中
 * LOCATION_INVALID，不再依赖文案。
 */
const SOURCE_TO_KIND = {
  LOCATION_DENIED: 'LOCATION_DENIED',
  LOCATION_SYSTEM_DENIED: 'LOCATION_DENIED',
  LOCATION_UNAVAILABLE: 'LOCATION_UNAVAILABLE',
  LOCATION_INVALID: 'LOCATION_INVALID',
  NETWORK_ERROR: 'NETWORK_ERROR',
  NAVIGATION_REVIEW_BLOCKED: 'NAVIGATION_REVIEW_BLOCKED',
  PROFILE_REVIEW_PENDING: 'PROFILE_REVIEW_PENDING',
  FEEDBACK_SUBMIT_UNKNOWN: 'FEEDBACK_SUBMIT_UNKNOWN',
  NOT_NAVIGABLE: 'NAVIGATION_REVIEW_BLOCKED',
  BLOCKED: 'NAVIGATION_REVIEW_BLOCKED',
  retryable: 'NETWORK_ERROR',
  unknown: 'FEEDBACK_SUBMIT_UNKNOWN',
};

/**
 * 替代文案嗅探的另路径纯函数：只按优先级读取结构化字段，绝不解析
 * message / errMsg 等用户可见文案。取不到返回 'UNKNOWN'，其中性短 label
 * 由 FAILURE_KIND.UNKNOWN 提供，页面用 FAILURE_KIND[kind] 取元信息。
 *
 * 优先级：data.locationFailure → data.kind → code → bizCode → category → name
 *
 * @param {object} error
 * @returns {string} FAILURE_KIND 的键；无结构化来源时为 'UNKNOWN'
 */
function resolveFailureKind(error) {
  if (!error || typeof error !== 'object') return 'UNKNOWN';
  const data = error.data && typeof error.data === 'object' ? error.data : {};
  const sources = [
    data.locationFailure,
    data.kind,
    error.code,
    error.bizCode,
    error.category,
    error.name,
  ];
  for (let i = 0; i < sources.length; i += 1) {
    const raw = sources[i];
    if (typeof raw !== 'string' || raw === '') continue;
    if (Object.prototype.hasOwnProperty.call(SOURCE_TO_KIND, raw)) {
      return SOURCE_TO_KIND[raw];
    }
  }
  return 'UNKNOWN';
}

/** 按 screen 查分支态；找不到返回 null，不抛异常、不编造默认值。 */
function getBranchView(screen) {
  return BRANCH_STATES.find((branch) => branch.screen === String(screen)) || null;
}

/**
 * 按 stateKey 查分支态；找不到返回 null。
 * viewState 由 18 / 20 共享，按数组顺序返回首个匹配（即 18）。
 */
function getBranchByStateKey(stateKey) {
  if (typeof stateKey !== 'string' || stateKey === '') return null;
  return BRANCH_STATES.find((branch) => branch.stateKey === stateKey) || null;
}

/** 7 态最小预览数据，仅含渲染所需字段，不含任何真实数据或凭据。 */
const PREVIEW_DATA = {
  '17': { locationHint: '定位被拒' },
  '18': { viewState: { type: 'retryable-error', title: '暂未加载' } },
  '19': { navReviewFailure: true, navReviewMessage: '复核未过' },
  '20': { viewState: { type: 'terminal-error', title: '当前不可查看' } },
  '21': { fromSubmit: true, result: { title: '反馈已提交' } },
  '22': { model: { hasPending: true } },
  '23': { locationFailed: true },
};

/** C 组「结构化状态驱动」与 A 组「页面内联条件分支」的路径差异。 */
const PATH_DIVERGENCE =
  'C 组：结构化状态驱动；' +
  '来源归一为 kind；' +
  '页面只读 kind 取态；' +
  'A 组：页面内联条件分支；' +
  '按可见文案反推状态；' +
  '文案改动即静默失效。';

module.exports = {
  BRANCH_STATES,
  FAILURE_KIND,
  resolveFailureKind,
  getBranchView,
  getBranchByStateKey,
  PREVIEW_DATA,
  PATH_DIVERGENCE,
};

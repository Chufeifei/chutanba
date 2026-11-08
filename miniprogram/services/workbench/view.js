/**
 * 工作台的视图数据装配（P09）。
 *
 * 单独成文件的原因：把「服务端快照 → 页面可直接渲染的字段」这一步集中在一处，
 * 页面的 setData 就只剩一行，不必在页面里重复判断"没有摊主"和"同步失败"的差异。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');
const { formatMoment } = require('../../utils/formatter');

/**
 * 工作台快照 → 页面视图数据。
 * @param {object} result services/workbench 的读结果
 */
function toViewPayload(result) {
  if (!result) return null;
  if (result.noVendor) {
    return {
      noVendor: true,
      showContent: false,
      canOpen: false,
      canOperate: false,
      model: null,
      cutoffOptions: [],
      cutoffIndex: 0,
      syncedText: '',
      viewState: createViewState(VIEW_STATE.EMPTY, result.emptyCopy),
    };
  }
  const model = result.model;
  return {
    noVendor: false,
    showContent: true,
    // 开摊与营业中操作是两个口径：eligibility 里含 SESSION_ACTIVE，营业中本就不该再开摊
    canOpen: model.eligibility.eligible && !model.isOpen,
    canOperate: model.isOpen,
    model,
    cutoffOptions: result.cutoffOptions,
    cutoffIndex: result.cutoffIndex,
    // 前台同步时间：页面收到一次新数据的时刻，与"最后成功定位时间"不是一回事
    syncedText: formatMoment(Date.now()),
    viewState: createViewState(VIEW_STATE.CONTENT),
  };
}

/**
 * 同步失败的视图数据：已有内容进 stale 并禁用动作；没有内容就是可重试错误。
 * @param {object} viewState utils/failure 转换出来的视图状态
 * @param {boolean} hadData 是否已经显示过内容
 */
function toFailurePayload(viewState, hadData) {
  if (!hadData) {
    return { showContent: false, canOpen: false, canOperate: false, viewState };
  }
  return {
    canOpen: false,
    canOperate: false,
    viewState: createViewState(VIEW_STATE.STALE, {
      description: '状态未更新',
    }),
  };
}

module.exports = { toViewPayload, toFailurePayload };

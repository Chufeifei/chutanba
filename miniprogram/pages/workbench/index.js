/**
 * P09 摊主工作台（架构占位页）。
 *
 * 职责：休息／出摊中状态、定位开摊、刷新位置与收摊。
 *
 * 本页只落了目录与路由，不含任何业务逻辑与接口调用 —— 属于后续开发范围。
 * 页面落位说明见 docs/arch/miniprogram-architecture.md §6。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');

Page({
  data: {
    viewState: createViewState(VIEW_STATE.EMPTY, {
      title: '摊主工作台',
      description: '目录与路由已就位，业务实现在后续开发中完成',
    }),
  },
});

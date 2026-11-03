/**
 * P07 摊主资料（架构占位页）。
 *
 * 职责：当前生效资料、待审修改与审核结果。
 *
 * 本页只落了目录与路由，不含任何业务逻辑与接口调用 —— 属于后续开发范围。
 * 页面落位说明见 docs/arch/miniprogram-architecture.md §6。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');

Page({
  data: {
    viewState: createViewState(VIEW_STATE.EMPTY, {
      title: '摊主资料',
      description: '目录与路由已就位，业务实现在后续开发中完成',
    }),
  },
});

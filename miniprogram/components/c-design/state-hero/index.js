/**
 * 空 / 错 / 成功态白卡（686×400rpx，圆角 --radius-card / 32rpx，
 * 插画插槽 + 主文案 38rpx + 副文案 32rpx + CTA 插槽）。
 *
 * 两个具名插槽（illustration / action），故 options.multipleSlots = true。
 * 未传插槽时，slot 内默认内容渲染「纯 CSS 几何色块简笔插画」兜底；
 * illustration 枚举 empty|error|success|pending 只决定兜底几何配色，
 * 页面若传自定义插槽则覆盖兜底。CTA 触发 action 事件，页面自行决定
 * 跳转/重试，组件不含业务逻辑。
 *
 * 接线适配：页面沿用 viewState.type（VIEW_STATE 十态）作为唯一状态入参，
 * 组件内部把它映射为兜底插画的 4 类配色，页面不必重复拼映射表达式；
 * 显式传入 illustration 且未给 type 时以 illustration 为准。
 * token 单一真相源：wxss 首行 @import component-tokens.wxss，根节点挂
 * .c-token-host，变量定义于根节点并向子节点继承，与样式隔离级别无关。
 * 具名 slot 默认内容的基础库支持存在分歧，未做真机验证；若终审环境不渲染
 * 默认内容，需把内置兜底/内置 CTA 提为独立节点并用属性开关与插槽互斥。
 */
Component({
  options: {
    multipleSlots: true,
  },

  properties: {
    title: { type: String, value: '' },
    description: { type: String, value: '' },
    actionText: { type: String, value: '' },
    illustration: { type: String, value: 'empty' },
    // 适配页面数据模型：页面统一传 viewState.type（VIEW_STATE 十态）
    type: { type: String, value: '' },
  },

  data: {
    illustrationClass: 'c-state-hero__art--empty',
  },

  observers: {
    'illustration, type'(illustration, type) {
      const allowed = ['empty', 'error', 'success', 'pending'];
      const TYPE_KIND = {
        loading: 'pending',
        empty: 'empty',
        stale: 'pending',
        permission: 'pending',
        'retryable-error': 'error',
        'terminal-error': 'error',
        'write-pending': 'pending',
        'write-unknown': 'pending',
        conflict: 'error',
        content: 'empty',
      };
      let kind = allowed.indexOf(illustration) >= 0 ? illustration : 'empty';
      if (type && Object.prototype.hasOwnProperty.call(TYPE_KIND, type)) {
        kind = TYPE_KIND[type];
      }
      this.setData({ illustrationClass: 'c-state-hero__art--' + kind });
    },
  },

  methods: {
    onAction() {
      this.triggerEvent('action', {
        illustration: this.properties.illustration,
        actionText: this.properties.actionText,
      });
    },
  },
});

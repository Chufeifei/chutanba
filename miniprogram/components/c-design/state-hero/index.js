/**
 * 空 / 错 / 成功态白卡（686×400rpx，圆角 --radius-card / 32rpx，
 * 插画插槽 + 主文案 38rpx + 副文案 32rpx + CTA 插槽）。
 *
 * 两个具名插槽（illustration / action），故 options.multipleSlots = true。
 * 未传插槽时，slot 内的默认内容渲染「纯 CSS 几何色块简笔插画」兜底，
 * 不引入任何图片资源；illustration 枚举 empty|error|success|pending 只决定
 * 兜底几何的配色，页面若传自定义插槽则覆盖兜底。
 * CTA 触发 action 事件，页面自行决定跳转/重试，组件不含业务逻辑。
 *
 * 注意：微信小程序对 slot 默认内容的支持存在基础库版本分歧（开放社区
 * 预告 2.8.1 起支持，但仍有「未支持」的实践记录），本轮未做真机验证；
 * 若终审环境不渲染默认内容，需把内置兜底/内置 CTA 提为组件独立节点
 * 并用属性开关与插槽互斥，详见 README.json 的接线说明。
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
  },

  data: {
    illustrationClass: 'c-state-hero__art--empty',
  },

  observers: {
    illustration(value) {
      const allowed = ['empty', 'error', 'success', 'pending'];
      const kind = allowed.indexOf(value) >= 0 ? value : 'empty';
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

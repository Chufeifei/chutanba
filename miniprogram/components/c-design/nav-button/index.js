/**
 * 摊位卡右下角「导航」小按钮（116×64rpx，全圆角 32rpx，品牌底白字）。
 *
 * Team C 组件驱动路径：把 vendor-card/index.wxml 内联的 .nav-btn 抽成独立
 * 组件，页面只声明引用，不再各写一份。
 * 用 catchtap 而非 bindtap：阻止冒泡到卡片整体，避免一次点击既导航又进详情。
 * detail.mode 固定 'navigate'，沿用 vendor-card select(mode) 的既有口径。
 */
Component({
  properties: {
    text: { type: String, value: '导航' },
    disabled: { type: Boolean, value: false },
  },

  methods: {
    onTap() {
      if (this.properties.disabled) return;
      this.triggerEvent('tap', { mode: 'navigate' });
    },
  },
});

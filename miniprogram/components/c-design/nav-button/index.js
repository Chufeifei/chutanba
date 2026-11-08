/**
 * 摊位卡右下角「导航」小按钮（116×64rpx，全圆角，品牌底白字）。
 *
 * Team C 组件驱动路径：把 vendor-card/index.wxml 内联的 .nav-btn 抽成独立
 * 组件，页面只声明引用，不再各写一份。
 * 用 catchtap 而非 bindtap：阻止冒泡到卡片整体，避免一次点击既导航又进详情。
 * 对外事件名用 nav 而非 tap：与原生 tap 同名会在父级被重复派发，且与
 * vendor-card「对外只抛 select」的口径不符；接线后一次点击只转成一次 select。
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
      this.triggerEvent('nav', { mode: 'navigate' });
    },
  },
});

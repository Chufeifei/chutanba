/**
 * 状态胶囊（36rpx 圆角 / --radius-chip，active / disabled 态，文字居中不出框）。
 *
 * 设计稿 07 页曾出现「文字飘出胶囊」缺陷：本组件用固定高度 + flex 居中 +
 * 双层 overflow:hidden + 单行省略收口，任何 text 都不会撑破胶囊。
 * bindtap 触发 change（disabled 时不触发）；value 随 detail 回传，
 * 便于页面做单选/筛选而不必另存一份映射。
 */
Component({
  properties: {
    text: { type: String, value: '' },
    active: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    value: { type: null, value: null }, // 透传值，类型不限（null = 任意类型）
    tone: { type: String, value: 'neutral' }, // neutral | success | warning，三态色值走 token
    fluid: { type: Boolean, value: false }, // true 时撑满父容器，用于一行均分的多胶囊场景
  },

  methods: {
    onTap() {
      if (this.properties.disabled) return;
      this.triggerEvent('change', {
        value: this.properties.value,
        active: !this.properties.active,
        text: this.properties.text,
      });
    },
  },
});

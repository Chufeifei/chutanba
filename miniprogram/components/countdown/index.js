/**
 * 剩余时间展示。
 *
 * 故意的"笨"组件：只显示页面算好的剩余文案，不自己起定时器、不判断是否到期。
 * 到期与否由服务端在主库时刻判定，客户端倒计时归零不等于可以停止展示，
 * 否则会出现"页面显示已到期、服务端仍可导航"的两套结论。
 */
Component({
  properties: {
    text: { type: String, value: '' },
    label: { type: String, value: '剩余' },
    tone: { type: String, value: 'neutral' },
  },
});

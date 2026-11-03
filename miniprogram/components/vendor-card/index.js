/**
 * 摊位卡片（P01 列表项与地图摘要卡共用）。
 *
 * 受控组件：只接收 services/discover/mapper 已经整形好的展示对象，
 * 不接收后端原始 vendor 对象，也不自己算距离/剩余时间 ——
 * 同一份计算在列表和地图各写一遍，迟早会出现两种口径。
 */
Component({
  properties: {
    vendor: { type: Object, value: null },
    // 地图摘要卡用紧凑排版，省略常卖摘要
    compact: { type: Boolean, value: false },
  },

  methods: {
    onTap() {
      const vendor = this.properties.vendor;
      if (!vendor || !vendor.vendorId) return;
      // 事件名不用 tap：会和原生 tap 同时触发，导致一次点击跳两次
      this.triggerEvent('select', { vendorId: vendor.vendorId });
    },
  },
});

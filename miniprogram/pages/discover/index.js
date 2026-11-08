/**
 * P01 找摊（列表 / 地图同源）。
 *
 * 三条硬约束：
 * 1. 列表与地图共用同一份 vendors，切视图只改渲染方式，不重新取数（验收 AC-1）；
 * 2. 同步走 behaviors/live-refresh：恢复前台先复核、失败标"未更新"并禁用新导航（R-01、AC-18）；
 * 3. 先出列表再定位：拒绝授权也要能浏览，不能把首屏卡在授权弹窗上（AC-01）。
 *
 * 页面只负责渲染与事件，取数与整形在 services/discover。
 */
const { VIEW_STATE, createViewState } = require('../../utils/view-state');
const { CATEGORY_ITEMS } = require('../../config/categories');
const timing = require('../../config/timing');
const discover = require('../../services/discover');
const liveRefresh = require('../../behaviors/live-refresh');

Page({
  behaviors: [liveRefresh],

  data: {
    viewState: createViewState(VIEW_STATE.LOADING),
    hasContent: false,
    // 同步失败的可见标记。页面自己算一份布尔值，wxml 不直接比较 behavior 的内部状态字符串
    syncStale: false,
    vendors: [],
    markers: [],
    // 只传叶子品类：后端品类白名单不含分组码
    categoryItems: CATEGORY_ITEMS,
    activeCategoryCode: '',
    viewMode: 'list',
    activeVendor: null,
    locationHint: '',
    // 地图中心只取摊主公开地标，绝不写顾客坐标（design.md §6）
    mapLatitude: 0,
    mapLongitude: 0,
    canShowLocation: false,
  },

  onLoad() {
    this._alive = true;
    this.setupLiveRefresh({
      fetcher: () => this.fetchVendors(),
      intervalMs: timing.PUBLIC_POLL_MS,
      onResult: (result) => this.applyResult(result),
      onFailure: (viewState) => this.applyFailure(viewState),
    });
    // 定位异步补齐：拿到就带距离刷新一次，拿不到就保持无距离浏览
    this.resolveLocation();
  },

  onUnload() {
    this._alive = false;
  },

  async resolveLocation() {
    const resolved = await discover.resolveViewerLocation();
    // 授权期间用户可能已经离开本页
    if (!this._alive) return;
    this._viewerLocation = resolved.location;
    // 顾客坐标只留在 this._viewerLocation（内存），不进 data：
    // 地图中心由摊主地标决定，蓝点靠 show-location 由原生层渲染
    this.setData({
      locationHint: discover.locationHintOf(resolved),
      canShowLocation: Boolean(resolved.location),
    });
    if (resolved.location) this.refreshLiveNow({ force: true });
  },

  onShow() {
    const app = getApp();
    const preferred = wx.getStorageSync('preferredViewMode')
      || (app.globalData && app.globalData.viewMode)
      || 'list';
    const viewMode = preferred === 'map' ? 'map' : 'list';
    this.setData({ viewMode });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: viewMode === 'map' ? 1 : 0 });
    }
  },

  fetchVendors() {
    return discover.loadVendors({
      categoryCode: this.data.activeCategoryCode,
      viewerLocation: this._viewerLocation,
    });
  },

  applyResult(result) {
    const vendors = result.vendors;
    const activeVendorId = this.data.activeVendor ? this.data.activeVendor.vendorId : '';
    // 地图摘要卡跟着最新结果走：摊位已收摊就自动关闭，不留旧坐标卡片
    const activeVendor = vendors.find((item) => item.vendorId === activeVendorId) || null;
    const firstMarker = result.markers[0];
    this.setData({
      vendors,
      markers: result.markers,
      hasContent: vendors.length > 0,
      syncStale: false,
      viewState: vendors.length > 0
        ? createViewState(VIEW_STATE.CONTENT)
        : createViewState(VIEW_STATE.EMPTY, result.emptyReason),
      activeVendor,
      mapLatitude: this.data.mapLatitude || (firstMarker ? firstMarker.latitude : 0),
      mapLongitude: this.data.mapLongitude || (firstMarker ? firstMarker.longitude : 0),
    });
  },

  applyFailure(viewState) {
    // 已经显示了内容就进 stale（禁用新导航），不要把列表清空伪装成空结果
    this.setData({
      syncStale: this.data.vendors.length > 0,
      viewState: this.data.vendors.length > 0
        ? createViewState(VIEW_STATE.STALE, { title: '状态未更新', description: '状态未更新' })
        : viewState,
    });
  },

  onCategoryChange(event) {
    this.setData({ activeCategoryCode: event.detail.code });
    // 条件已变：必须丢弃在途请求，否则会显示上一个品类的结果
    this.refreshLiveNow({ force: true });
  },

  onViewModeChange(event) {
    // 只切换渲染方式，不重新取数（同一份 vendors）；
    // 与 custom-tab-bar 的 persistViewMode 写同一组键，避免 onShow 恢复时把地图打回列表
    const mode = event.currentTarget.dataset.mode === 'map' ? 'map' : 'list';
    const app = getApp();
    if (!app.globalData) app.globalData = {};
    app.globalData.viewMode = mode;
    wx.setStorageSync('preferredViewMode', mode);
    this.setData({ viewMode: mode });
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: mode === 'map' ? 1 : 0 });
    }
  },

  onMarkerTap(event) {
    const vendorId = discover.vendorIdAt(this.data.vendors, event.detail.markerId);
    const vendor = this.data.vendors.find((item) => item.vendorId === vendorId) || null;
    this.setData({ activeVendor: vendor });
  },

  onVendorTap(event) {
    const vendorId = event.detail.vendorId;
    if (!vendorId) return;
    // 卡片整体 select 进详情；导航小按钮复用同一事件带 mode 标记
    const intent = event.detail.mode === 'navigate' ? '&intent=navigate' : '';
    wx.navigateTo({ url: `/pages/vendor-detail/index?vendorId=${encodeURIComponent(vendorId)}${intent}` });
  },

  onOpenSetting(event) {
    const auth = event.detail && event.detail.authSetting;
    if (!auth || !auth['scope.userLocation']) return;
    this.setData({ locationHint: '' });
    this.resolveLocation();
  },

  onStateAction() {
    this.refreshLiveNow({ force: true });
  },

  onPullDownRefresh() {
    this.refreshLiveNow({ force: true }).then(() => wx.stopPullDownRefresh());
  },
});

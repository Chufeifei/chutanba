const { listVendorsByRegion, searchVendorsByRadius } = require('../../api/discover');
const { listRegions } = require('../../api/regions');
const { VIEW_STATE, createViewState, viewStateFromError } = require('../../utils/view-state');

const DEFAULT_RADIUS_M = 1000;

/**
 * 发现页：摊位位置筛选入口。
 *
 * 定位只在用户主动使用半径筛选时请求（NFR-PR-01）；
 * 顾客拒绝授权时降级为仅区域筛选并呈 permission 态，不阻塞区域筛选。
 */
Page({
  data: {
    viewState: VIEW_STATE.CONTENT,
    stateTitle: '',
    stateDescription: '',
    stateActionText: '',
    regions: [],
    selectedRegionId: '',
    radiusM: DEFAULT_RADIUS_M,
    useRadius: false,
    items: [],
    conditionSummary: '',
  },

  onLoad() {
    this.loadRegions();
  },

  /** 读取启用区域字典。区域筛选不需要顾客位置。 */
  async loadRegions() {
    try {
      const result = await listRegions();
      const regions = (result && result.data && result.data.items) || [];
      this.setData({ regions });
      await this.loadVendors();
    } catch (error) {
      this.applyError(error);
    }
  },

  onSelectRegion(event) {
    const regionId = event.currentTarget.dataset.regionId || '';
    this.setData({ selectedRegionId: regionId }, () => this.loadVendors());
  },

  onRadiusInput(event) {
    const value = Number(event.detail.value);
    this.setData({ radiusM: Number.isFinite(value) && value > 0 ? value : DEFAULT_RADIUS_M });
  },

  /**
   * 用户主动使用半径筛选时才请求顾客位置。
   * 拒绝授权不视为失败：降级为仅区域筛选。
   */
  async onRadiusFilterTap() {
    const radiusM = Number(this.data.radiusM);
    if (!Number.isFinite(radiusM) || radiusM <= 0) {
      wx.showToast({ title: '请输入有效半径', icon: 'none' });
      return;
    }

    let location;
    try {
      location = await this.requestCustomerLocation();
    } catch (error) {
      // 定位被拒绝：降级为仅区域筛选，保留区域筛选能力。
      this.setData({ useRadius: false });
      wx.showToast({ title: '未获得位置权限，已按区域筛选', icon: 'none' });
      await this.loadVendors();
      return;
    }

    this.setData({ useRadius: true });
    await this.loadVendors(location);
  },

  /** 请求顾客本次位置。精确位置只用于当次距离计算，不落库、不回显。 */
  requestCustomerLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => {
          if (!res || !Number.isFinite(res.latitude) || !Number.isFinite(res.longitude)) {
            reject(new Error('位置无效'));
            return;
          }
          resolve({ lat: res.latitude, lng: res.longitude });
        },
        fail: (error) => reject(error),
      });
    });
  },

  onClearFilters() {
    this.setData({ selectedRegionId: '', useRadius: false }, () => this.loadVendors());
  },

  onRetry() {
    this.loadVendors();
  },

  async loadVendors(location) {
    this.setData({
      viewState: VIEW_STATE.LOADING,
      stateTitle: '',
      stateDescription: '',
      stateActionText: '',
    });

    const useRadius = this.data.useRadius;
    const regionId = this.data.selectedRegionId;

    try {
      let result;
      if (useRadius) {
        const point = location || this.lastLocation || null;
        if (!point) {
          this.setData({
            viewState: createViewState(VIEW_STATE.PERMISSION, {
              title: '需要位置权限',
              description: '使用半径筛选需要你提供本次位置，也可以只按区域筛选。',
              actionText: '重新选择半径',
            }),
          });
          return;
        }
        this.lastLocation = point;
        // 精确坐标走 POST body，不进 URL 与访问日志。
        result = await searchVendorsByRadius({
          lat: point.lat,
          lng: point.lng,
          radiusM: Number(this.data.radiusM),
          regionId: regionId || null,
        });
      } else {
        // 仅区域筛选：不需要顾客位置，走 GET。
        result = await listVendorsByRegion(regionId ? { regionId } : {});
      }

      const items = (result && result.data && result.data.items) || [];
      this.setData({ items, conditionSummary: this.buildConditionSummary() });
      if (items.length === 0) {
        this.setData({
          viewState: createViewState(VIEW_STATE.EMPTY, {
            title: '没有符合条件的摊位',
            description: '当前筛选条件下没有具有公开位置的摊位，可以调整区域或半径。',
          }),
        });
        return;
      }
      this.setData({ viewState: VIEW_STATE.CONTENT });
    } catch (error) {
      this.applyError(error);
    }
  },

  buildConditionSummary() {
    const parts = [];
    const region = this.data.regions.find((item) => item.regionId === this.data.selectedRegionId);
    if (region) {
      parts.push(`区域：${region.regionName}`);
    }
    if (this.data.useRadius) {
      parts.push(`半径：${this.data.radiusM} 米`);
    }
    return parts.join(' · ');
  },

  applyError(error) {
    const state = viewStateFromError(error);
    // 可重试失败提供「重试」入口；权限态由 state-view 的 permission 分支呈现。
    const isRetryable = state.type === VIEW_STATE.RETRYABLE_FAILURE;
    this.setData({
      viewState: state.type,
      stateTitle: state.title,
      stateDescription: state.description,
      stateActionText: isRetryable ? '重试' : state.actionText,
    });
  },
});

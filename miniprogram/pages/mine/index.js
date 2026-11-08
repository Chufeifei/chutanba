/**
 * P03 我的。
 *
 * 入口可见性只由 store/identity 的 capabilities 决定，不在这里写"有 vendorId 就是摊主"。
 * 即使某个入口被隐藏，服务端仍会对直接请求重新鉴权（AC-13）—— 隐藏不是权限。
 *
 * 本人快照来自 GET /me，进入本页时刷新一次；刷新失败保留旧快照，
 * 公开浏览不受影响（需求第 2 节）。
 */
const identityStore = require('../../store/identity');
const { refreshIdentity, describeProfileState } = require('../../services/account');
const openDays = require('../../services/open-days');
const feedback = require('../../services/feedback');
const { CAPABILITY } = require('../../config/contracts');
const { VIEW_STATE, createViewState } = require('../../utils/view-state');

// 入口到能力的映射：有能力才显示，能力来自服务端 /me，不来自客户端推断
const ENTRY_DEFS = [
  { key: 'feedback', text: '现场反馈', capability: CAPABILITY.SUBMIT_FEEDBACK },
  { key: 'profile', text: '摊主资料', capability: CAPABILITY.MANAGE_PROFILE },
  { key: 'workbench', text: '摊主工作台', capability: CAPABILITY.OPERATE_SESSION },
  { key: 'publication', text: '公开与资料处理', capability: CAPABILITY.CONTROL_PUBLICATION },
  { key: 'management', text: '管理入口', capability: CAPABILITY.MANAGE_PROFILE_REVIEW },
];

// 已交付页面的真实路由，逐条对应 app.json 的 pages / subPackages
const ENTRY_ROUTES = {
  feedback: '/pages/feedback-candidates/index',
  profile: '/pages/vendor-profile/index',
  workbench: '/pages/workbench/index',
  publication: '/pages/publication/index',
  management: '/packageManagement/pages/index/index',
};

// 治理能力单独落在白卡列表下方，只由能力位决定是否可见
const GOVERNANCE_KEY = 'management';

Page({
  data: {
    identified: false,
    unidentifiedState: createViewState(VIEW_STATE.PERMISSION, {
      title: '账号暂不可识别',
      description: '请重新识别账号',
    }),
    profileStateLabel: '未申请',
    profileEligible: false,
    selfStopped: false,
    governancePaused: false,
    entries: [],
    showGovernance: false,
    // 两枚小卡取只读域接口的真实值，未取到前显示 —，不以 0 起步
    statOpenDays: '—',
    statFeedbackCount: '—',
  },

  onLoad() {
    this.unsubscribeIdentity = identityStore.subscribe(() => this.renderIdentity());
    this.renderIdentity();
  },

  onShow() {
    // 与 discover.onShow 同口径读取视图偏好，让三态闭环在两页写法一致：
    // 「我的」恒为 selected=2，偏好只回填内存态、不改写持久化，
    // 从地图切到本页再回首页时 discover.onShow 仍按原偏好恢复，不漂移。
    const app = getApp();
    const preferred = wx.getStorageSync('preferredViewMode')
      || (app.globalData && app.globalData.viewMode)
      || 'list';
    if (!app.globalData) app.globalData = {};
    app.globalData.viewMode = preferred === 'map' ? 'map' : 'list';
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    // 静默刷新：失败时保留已有快照，不把页面清空；成功后再取两枚小卡的值
    refreshIdentity({ silent: true })
      .then(() => this.loadStats())
      .catch(() => null);
    this.renderIdentity();
  },

  onUnload() {
    // 订阅必须成对取消，否则页面销毁后仍被回调
    if (this.unsubscribeIdentity) this.unsubscribeIdentity();
  },

  renderIdentity() {
    const snapshot = identityStore.getSnapshot();
    const visible = ENTRY_DEFS.filter((entry) => identityStore.hasCapability(entry.capability));
    this.setData({
      identified: Boolean(snapshot),
      profileStateLabel: describeProfileState(snapshot && snapshot.profileState),
      profileEligible: Boolean(snapshot && snapshot.profileEligible),
      selfStopped: Boolean(snapshot && snapshot.selfStopped),
      governancePaused: Boolean(snapshot && snapshot.governancePaused),
      entries: visible.filter((entry) => entry.key !== GOVERNANCE_KEY),
      showGovernance: visible.some((entry) => entry.key === GOVERNANCE_KEY),
    });
  },

  /** 两枚小卡各取一个只读域接口的真实值；读取失败保留当前显示，不回退成占位数字。 */
  async loadStats() {
    const snapshot = identityStore.getSnapshot();
    if (!snapshot || !snapshot.accountId) return;
    try {
      const result = await openDays.loadOpenDays();
      this.setData({ statOpenDays: result.model ? result.model.totalDays : 0 });
    } catch (error) {
      // 读取失败保留已有值
    }
    try {
      const page = await feedback.loadMyRecords();
      this.setData({ statFeedbackCount: page.records.length });
    } catch (error) {
      // 读取失败保留已有值
    }
  },

  onEntryTap(event) {
    const key = event.currentTarget.dataset.key;
    const route = ENTRY_ROUTES[key];
    if (!route) return;
    wx.navigateTo({ url: route });
  },

  /** 身份由服务端 capabilities 判定，本入口只跳转到资料状态页查看，不做本地身份切换。 */
  onSwitchTap() {
    wx.navigateTo({ url: '/pages/vendor-profile/index' });
  },
});

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
const { CAPABILITY } = require('../../config/contracts');
const { VIEW_STATE, createViewState } = require('../../utils/view-state');

// 入口到能力的映射：有能力才显示，能力来自服务端 /me，不来自客户端推断
const ENTRY_DEFS = [
  { key: 'feedback', text: '现场反馈', hint: '查看可反馈的营业轮次与已提交记录', capability: CAPABILITY.SUBMIT_FEEDBACK },
  { key: 'profile', text: '摊主资料', hint: '提交或修改基本资料，查看审核结果', capability: CAPABILITY.MANAGE_PROFILE },
  { key: 'workbench', text: '摊主工作台', hint: '定位开摊、刷新位置、收摊', capability: CAPABILITY.OPERATE_SESSION },
  { key: 'publication', text: '公开与资料处理', hint: '停止或恢复公开、处理个人资料', capability: CAPABILITY.CONTROL_PUBLICATION },
  {
    key: 'management',
    text: '管理入口',
    hint: '资料审核、现场复核、治理与人工复核',
    capability: CAPABILITY.MANAGE_PROFILE_REVIEW,
  },
];

// 已交付页面的真实路由。未交付的入口不跳转，只给一句明确说明。
const ENTRY_ROUTES = {
  feedback: '/pages/feedback-candidates/index',
  profile: '/pages/vendor-profile/index',
  workbench: '/pages/workbench/index',
  publication: '/pages/publication/index',
  management: '/packageManagement/pages/index/index',
};

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
    // 数据小卡字段：一期 /me 未下发统计值，确定值 0，待统计接口接入后由 renderIdentity 覆写
    statOpenDays: 0,
    statFeedbackCount: 0,
  },

  onLoad() {
    this.unsubscribeIdentity = identityStore.subscribe(() => this.renderIdentity());
    this.renderIdentity();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    // 静默刷新：失败时保留已有快照，不把页面清空
    refreshIdentity({ silent: true }).catch(() => null);
    this.renderIdentity();
  },

  onUnload() {
    // 订阅必须成对取消，否则页面销毁后仍被回调
    if (this.unsubscribeIdentity) this.unsubscribeIdentity();
  },

  renderIdentity() {
    const snapshot = identityStore.getSnapshot();
    this.setData({
      identified: Boolean(snapshot),
      profileStateLabel: describeProfileState(snapshot && snapshot.profileState),
      profileEligible: Boolean(snapshot && snapshot.profileEligible),
      selfStopped: Boolean(snapshot && snapshot.selfStopped),
      governancePaused: Boolean(snapshot && snapshot.governancePaused),
      entries: ENTRY_DEFS.filter((entry) => identityStore.hasCapability(entry.capability)),
    });
  },

  onEntryTap(event) {
    const key = event.currentTarget.dataset.key;
    const route = ENTRY_ROUTES[key];
    if (!route) {
      wx.showToast({ title: '暂不可用', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: route });
  },

  /** 身份由服务端 capabilities 判定，本入口只跳转到资料状态页查看，不做本地身份切换。 */
  onSwitchTap() {
    wx.navigateTo({ url: '/pages/vendor-profile/index' });
  },
});

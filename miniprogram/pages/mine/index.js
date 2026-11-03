/**
 * P03 我的。
 *
 * 入口可见性只由 store/identity 的 capabilities 决定，不在这里写"有 vendorId 就是摊主"。
 * 即使某个入口被隐藏，服务端仍会对直接请求重新鉴权（AC-13）—— 隐藏不是权限。
 *
 * 本页当前是**架构骨架**：只读 store、渲染入口，不含业务实现。
 * 架构说明见 docs/arch/miniprogram-architecture.md §6；路由与身份刷新属于后续开发。
 */
const identityStore = require('../../store/identity');
const { describeProfileState } = require('../../services/account');
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

Page({
  data: {
    identified: false,
    unidentifiedState: createViewState(VIEW_STATE.PERMISSION, {
      title: '账号暂不可识别',
      description: '完成微信身份识别后可查看本人记录与操作入口',
    }),
    profileStateLabel: '未提交',
    profileEligible: false,
    selfStopped: false,
    governancePaused: false,
    entries: [],
  },

  onLoad() {
    this.unsubscribeIdentity = identityStore.subscribe(() => this.renderIdentity());
    this.renderIdentity();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
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
    // P3 接入各页路由后替换为真正的跳转
    wx.showToast({ title: `${key} 页面开发中`, icon: 'none' });
  },
});

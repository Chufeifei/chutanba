/**
 * 自定义 tabBar（一期只有两个主入口：找摊 / 我的）。
 *
 * 页面在 onShow 里通过 this.getTabBar().setData({ selected }) 同步选中项，
 * 组件本身不感知路由，只负责渲染与切换。
 */
const TABS = [
  { pagePath: '/pages/discover/index', text: '找摊', icon: 'home', activeIcon: 'home-active' },
  { pagePath: '/pages/mine/index', text: '我的', icon: 'user', activeIcon: 'user-active' },
];

Component({
  data: {
    selected: 0,
    tabs: TABS,
  },

  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const tab = TABS[index];
      if (!tab) return;
      wx.switchTab({ url: tab.pagePath });
    },
  },
});

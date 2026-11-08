/**
 * 自定义 tabBar（三态：首页 / 地图 / 我的）。
 *
 * 约定：
 * 1. selected：0=首页、1=地图、2=我的。页面 onShow 仍可用
 *    this.getTabBar().setData({ selected }) 同步，但需对齐三态值（见实现回执 risks）。
 * 2. 「地图」不是独立路由（app.json tabBar.list 仅 discover / mine 两项，pagePath 必须唯一），
 *    它只是 discover 页的 viewMode='map'，因此点击地图不 switchTab，只切渲染方式。
 * 3. 视图意图写三处，取「最简单可靠」组合；组件不 require 任何页面模块，无循环依赖：
 *    - getApp().globalData.viewMode：内存态，供任意页面即时读取；
 *    - wx.setStorageSync('preferredViewMode')：持久化，供页面 onShow / 冷启动读取；
 *    - getCurrentPages() 当前页 .setData({ viewMode })：当前就在 discover 时立即刷新，
 *      无需页面侧先实现事件总线。
 */
const TABS = [
  { key: 'home', text: '首页', pagePath: '/pages/discover/index', icon: 'home', activeIcon: 'home-active' },
  // map-active.svg 资源不存在，activeIcon 复用真实存在的 map.svg；
  // 激活态由 index.wxss 的 filter: brightness(0) invert(1) 置白，与设计稿一致。
  { key: 'map', text: '地图', icon: 'map', activeIcon: 'map', viewMode: 'map' },
  { key: 'mine', text: '我的', pagePath: '/pages/mine/index', icon: 'user', activeIcon: 'user-active' },
];

const DISCOVER_PATH = '/pages/discover/index';

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

      // 高亮三态由组件自身维护，不依赖目标页 onShow 先执行
      this.setData({ selected: index });

      if (tab.key === 'mine') {
        wx.switchTab({ url: tab.pagePath });
        return;
      }

      // home -> 列表视图；map -> 地图视图；两者都以 discover 为落点
      // 视图意图直接取 TABS 声明的 viewMode，避免 key 硬编码与声明分叉
      const mode = tab.viewMode || 'list';
      this.persistViewMode(mode);

      const current = getCurrentPages().slice(-1)[0];
      const onDiscover = current && ('/' + current.route) === DISCOVER_PATH;

      if (onDiscover) {
        // 已在 discover：直接切视图，不做 switchTab（地图本就不是独立路由）
        current.setData({ viewMode: mode });
      } else {
        // 从「我的」等页回来：先切到 discover，再在 success 里补一次视图同步
        wx.switchTab({
          url: DISCOVER_PATH,
          success: () => {
            const page = getCurrentPages().slice(-1)[0];
            if (page && typeof page.setData === 'function') page.setData({ viewMode: mode });
          },
        });
      }
    },

    persistViewMode(mode) {
      const app = getApp();
      // app.js 未声明 globalData，这里按需初始化，避免赋值到 undefined 报错
      if (!app.globalData) app.globalData = {};
      app.globalData.viewMode = mode;
      wx.setStorageSync('preferredViewMode', mode);
    },
  },
});

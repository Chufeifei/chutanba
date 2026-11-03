/**
 * 前台实时同步（R-01 的唯一实现处）。
 *
 * 需求 R-01 / AC-18 要求：已打开的前台页面最多 60 秒同步；恢复前台先复核；
 * 同步失败必须明确提示"状态未更新"，并且不能用缓存坐标新发起导航。
 *
 * 这套流程会出现在 P01、P02、P04、P09、P16 等多个页面，
 * 所以只在这里写一次 —— 各页面只提供"取数函数"和"拿到结果后怎么 setData"。
 *
 * 三个容易做错的点，本文件已处理：
 * 1. 请求去重：同一时刻只允许一个在途请求，轮询不会叠加；
 * 2. 丢弃过时响应：序号落后的响应直接丢弃，不覆盖更新的结果；
 * 3. 失败不等于空：已有内容时进入 stale，而不是把列表清空。
 *
 * 使用方式（页面引入 ./behaviors/live-refresh.js 后）：
 *   behaviors: [liveRefresh]
 *   onLoad() {
 *     this.setupLiveRefresh({
 *       fetcher: () => discoverService.loadPublicVendors({ categoryCode }),
 *       intervalMs: timing.PUBLIC_POLL_MS,
 *       onResult: (result) => this.setData({ vendors: result.items, viewState: ... }),
 *       onFailure: (viewState) => this.setData({ viewState }),
 *     });
 *   }
 */
const { toViewState } = require('../utils/failure');

const SYNC_STATE = Object.freeze({
  IDLE: 'idle',
  SYNCING: 'syncing',
  OK: 'ok',
  STALE: 'stale',
});

module.exports = Behavior({
  data: {
    liveSyncState: SYNC_STATE.IDLE,
    liveSyncedAtMs: 0,
  },

  methods: {
    /**
     * @param {object} config
     * @param {function} config.fetcher 返回 Promise 的取数函数（由页面传入，Behavior 不碰 service）
     * @param {number} config.intervalMs 轮询间隔
     * @param {function} [config.onResult] 成功回调，参数为 fetcher 的结果
     * @param {function} [config.onFailure] 失败回调，参数为已转换的 viewState
     */
    setupLiveRefresh(config) {
      if (!config || typeof config.fetcher !== 'function') {
        throw new TypeError('setupLiveRefresh 需要 fetcher');
      }
      this._liveConfig = config;
      this._liveSeq = this._liveSeq || 0;
      this._liveInFlight = null;
      this._liveHasData = false;

      if (!this._liveNetworkBound) {
        this._liveNetworkBound = true;
        this._onNetworkChange = (res) => {
          // 网络恢复立即复核，不等下一个轮询周期
          if (res && res.isConnected) this.refreshLiveNow();
        };
        if (wx.onNetworkStatusChange) {
          wx.onNetworkStatusChange(this._onNetworkChange);
        }
      }

      this.startLiveLoop();
      return this.refreshLiveNow();
    },

    /**
     * 立即复核。
     * @param {object} [options]
     * @param {boolean} [options.force] 条件已变（换品类、下拉刷新）时丢弃在途请求重新取数；
     *   否则在途请求会被直接复用，切完品类后仍显示旧条件的结果
     */
    refreshLiveNow(options = {}) {
      const config = this._liveConfig;
      if (!config) return Promise.resolve();

      // 去重必须放在序号自增之前，否则在途请求的响应会被误判为过时
      if (this._liveInFlight && !options.force) return this._liveInFlight;

      const seq = (this._liveSeq = (this._liveSeq || 0) + 1);
      this.setData({ liveSyncState: SYNC_STATE.SYNCING });

      const request = config.fetcher()
        .then((result) => {
          if (seq !== this._liveSeq) return result;
          this._liveHasData = true;
          this.setData({ liveSyncState: SYNC_STATE.OK, liveSyncedAtMs: Date.now() });
          if (config.onResult) config.onResult(result);
          return result;
        })
        .catch((error) => {
          if (seq !== this._liveSeq) return null;
          const viewState = toViewState(error);
          this.setData({ liveSyncState: SYNC_STATE.STALE });
          if (config.onFailure) config.onFailure(viewState, { hadData: this._liveHasData });
          return null;
        })
        .then((value) => {
          // 只有当前请求能清空在途标记：强制刷新时旧请求结束不得清掉新请求的引用
          if (this._liveInFlight === request) this._liveInFlight = null;
          return value;
        });

      this._liveInFlight = request;
      return request;
    },

    startLiveLoop() {
      if (this._liveTimer || !this._liveConfig || !this._liveConfig.intervalMs) return;
      this._liveTimer = setInterval(() => {
        this.refreshLiveNow();
      }, this._liveConfig.intervalMs);
    },

    stopLiveLoop() {
      if (!this._liveTimer) return;
      clearInterval(this._liveTimer);
      this._liveTimer = null;
    },

    /** 页面判断"现在能不能发起依赖新鲜状态的动作"。 */
    isLiveFresh() {
      return this.data.liveSyncState === SYNC_STATE.OK;
    },

    teardownLiveRefresh() {
      this.stopLiveLoop();
      this._liveConfig = null;
      this._liveInFlight = null;
      // 序号继续增长，任何迟到的响应都会因为落后而被丢弃
      this._liveSeq = (this._liveSeq || 0) + 1;
      if (this._liveNetworkBound && wx.offNetworkStatusChange) {
        wx.offNetworkStatusChange(this._onNetworkChange);
      }
      this._liveNetworkBound = false;
    },
  },

  // 恢复前台先复核，离开前台停止轮询（技术设计 §5）
  onShow() {
    if (!this._liveConfig) return;
    this.startLiveLoop();
    this.refreshLiveNow();
  },

  onHide() {
    this.stopLiveLoop();
  },

  onUnload() {
    this.teardownLiveRefresh();
  },
});

const cloudConfig = require('./config/cloud');

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('当前微信基础库不支持 wx.cloud，请升级微信开发者工具或基础库');
      return;
    }

    // 云开发只需在小程序启动时初始化一次，页面和组件不要重复调用 wx.cloud.init。
    const initOptions = {
      traceUser: true,
    };

    // 未配置时不传入假环境 ID；request 工具会在真正发起请求前给出明确错误。
    if (cloudConfig.envId) {
      initOptions.env = cloudConfig.envId;
    }

    wx.cloud.init(initOptions);
  },
});

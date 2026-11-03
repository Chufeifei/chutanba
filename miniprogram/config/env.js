/**
 * 运行环境标识。
 *
 * 只回答"当前跑在哪个环境"，不承载任何业务开关。
 * 小程序没有 process.env，用微信自身的版本号判定：
 * 开发版 / 体验版一律按开发处理，只有正式版才算生产。
 */
const ENV = Object.freeze({
  DEVELOPMENT: 'development',
  PRODUCTION: 'production',
});

function resolveEnv() {
  try {
    const accountInfo = wx.getAccountInfoSync();
    const envVersion = accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion;
    // release = 正式版；develop/trial 均为非生产，避免联调地址流入线上
    return envVersion === 'release' ? ENV.PRODUCTION : ENV.DEVELOPMENT;
  } catch (error) {
    // 基础库过低时取不到版本信息，保守按开发环境处理并在启动时暴露问题
    return ENV.DEVELOPMENT;
  }
}

const current = resolveEnv();

module.exports = {
  ENV,
  current,
  isProduction: current === ENV.PRODUCTION,
  isDevelopment: current === ENV.DEVELOPMENT,
};

/**
 * 云环境与后端服务地址。禁止在 request 或页面里硬编码。
 *
 * 三种组合的行为（由 utils/request.js 判定，不要在其他地方重复判断）：
 * 1. serviceName 有值           → 强制走 wx.cloud.callContainer（生产路径）
 * 2. serviceName 为空 + localBaseUrl 有值 → 走 wx.request（仅本地联调）
 * 3. 两者都为空                 → 请求前置校验失败，给出可读错误而不是静默发往未知地址
 *
 * 上线前必做：把云托管控制台的服务名填进 serviceName，并清空 localBaseUrl。
 * 生产环境不会带 X-Dev-Openid，该头只在后端 NODE_ENV 非 production 时生效。
 */
const env = require('./env');

const CLOUD_ENV_ID = 'cloud1-d8g02pi8zeb282ff3';

module.exports = {
  envId: CLOUD_ENV_ID,

  // TODO(deploy): 填入云托管服务名（控制台「服务列表」中的服务名称）。为空即走本地联调。
  serviceName: '',

  // 本地联调地址：开发者工具用 127.0.0.1，真机需替换为电脑局域网 IP。生产环境强制为空。
  localBaseUrl: env.isProduction ? '' : 'http://127.0.0.1:3000',

  // 本地联调身份：仅后端非生产环境认可，用于免登录走通本人接口。
  localDevOpenid: env.isProduction ? '' : 'dev-openid-local',
};

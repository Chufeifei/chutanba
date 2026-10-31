/**
 * 微信云开发与云托管配置。
 * 环境 ID 和服务名称不是密码，可以随小程序代码发布；但必须填写控制台中的真实值。
 * 如果开发、体验、生产环境使用不同资源，后续可将本文件扩展为按 envVersion 选择配置。
 */
module.exports = Object.freeze({
  // 本地联调服务地址。仅在 serviceName 为空时生效，填写后 request.js 改用 wx.request。
  // 开发者工具示例：http://127.0.0.1:3000
  // 真机联调不能使用 127.0.0.1/localhost，请填写电脑在局域网内可访问的 IP。
  localBaseUrl: 'http://127.0.0.1:3000',

  // 本地 wx.request 不会获得云托管注入的 OpenID；开发后端用此值识别联调用户。
  // 该请求头仅在 localBaseUrl 生效时发送，生产后端不会接受它。
  localDevOpenid: 'local-dev-user',

  // 示例格式：cloud1-1gxxxxxxxxxxxxxx
  envId: 'cloud1-d7gj8oz1e184eaf09',

  // 微信云开发控制台 → 云托管 → 服务列表中显示的服务名称；有值时无条件使用云托管。
  // serviceName: 'chutanba-backend',
  serviceName: '',

  // 微信公众平台中配置的订阅消息模板；留空时业务照常成立并记录为 UNAVAILABLE。
  templates: Object.freeze({
    vendorOpened: '',
    reservationAffected: '',
    vendorAutoClosed: '',
  }),
});

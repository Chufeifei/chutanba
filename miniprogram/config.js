module.exports = {
  APP_NAME: '出摊吧',

  // 正式版本默认启用微信云开发，才能获取真实 OpenID、管理员身份和订阅提醒。
  USE_CLOUD: true,

  // 留空表示使用微信开发者工具当前绑定的云环境；也可以填写指定环境 ID。
  CLOUD_ENV: 'cloud1-d8g02pi8zeb282ff3',

  // 正式项目不使用本地数据回退，避免云端与本地数据错位。
  ALLOW_DEMO_FALLBACK: false,

  // 上线前必须替换。
  OPERATOR_NAME: '出摊吧',
  CONTACT_EMAIL: '1144272474@qq.com',

  // 在公众平台申请“一次性订阅消息”模板后填写。
  // 推荐字段：thing1=摊位名称，time2=出摊时间，thing3=地点。
  REMINDER_TEMPLATE_ID: ''
}

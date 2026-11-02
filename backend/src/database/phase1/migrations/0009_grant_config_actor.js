// 授权由部署名单驱动，没有操作者账号；授予人必须允许为空，否则同步无法写入。
module.exports = {
  description: '部署配置授予允许无操作者',
  statements: [
    `ALTER TABLE cb_admin_permission_grant
      MODIFY granted_by_account_id BIGINT UNSIGNED NULL`,
  ],
};

// 已执行的 0001～0007 不就地修改；权限目录种子通过新增迁移补齐。
module.exports = {
  description: '一期权限目录种子：资料审核与现场审核',
  statements: [
    // grantable_to_admin=0：这两类审核权限只由部署名单授予，管理界面不得再转授。
    // 使用 ON DUPLICATE KEY UPDATE 保证空库与重复执行都得到同一目录内容。
    `INSERT INTO cb_admin_permission (permission_code, permission_name, permission_group, grantable_to_admin)
      VALUES ('PROFILE_REVIEWER', '资料审核员', 'REVIEW', 0), ('FIELD_REVIEWER', '现场审核员', 'REVIEW', 0)
      ON DUPLICATE KEY UPDATE
        permission_name = VALUES(permission_name),
        permission_group = VALUES(permission_group),
        grantable_to_admin = VALUES(grantable_to_admin)`,
  ],
};

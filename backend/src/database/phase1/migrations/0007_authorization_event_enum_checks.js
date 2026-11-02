module.exports = {
  description: '补齐授权事件表已定义的枚举白名单约束',
  statements: [
    // 这两个取值在《管理员权限与地域授权设计》中已明确写死；0001 只约束了 event_type，
    // 遗漏角色与范围枚举会让拼错的授权事件静默落库，因此单列补丁迁移追加。
    `ALTER TABLE cb_admin_authorization_event
      ADD CONSTRAINT ck_authorization_event_role CHECK (role_code IS NULL OR role_code IN ('ADMIN','SUPER_ADMIN')),
      ADD CONSTRAINT ck_authorization_event_scope CHECK (scope_type IS NULL OR scope_type IN ('NATIONAL','CITY','REGION'))`,
  ],
};

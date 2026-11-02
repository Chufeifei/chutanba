// 已执行的迁移只增不改；精确匹配的标识、代码和状态使用二进制排序规则。
module.exports = {
  description: '一期标识和状态字段采用精确排序规则',
  statements: [
    `ALTER TABLE cb_user_account
      MODIFY wx_openid VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
      MODIFY wx_unionid VARCHAR(128) COLLATE utf8mb4_bin NULL,
      MODIFY status VARCHAR(16) COLLATE utf8mb4_bin NOT NULL DEFAULT 'ACTIVE'`,
    `ALTER TABLE cb_vendor_identity
      MODIFY vendor_code VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
      MODIFY lifecycle_status VARCHAR(32) COLLATE utf8mb4_bin NOT NULL DEFAULT 'ACTIVE'`,
    `ALTER TABLE cb_user_role
      MODIFY role_code VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
      MODIFY status VARCHAR(16) COLLATE utf8mb4_bin NOT NULL`,
    // 权限目录原先用 permission_code 作主键，违反“新表必须带 id BIGINT 主键”的表设计约定；
    // 权限代码仍以唯一键保持精确匹配，不允许重复代码。
    `ALTER TABLE cb_admin_permission
      DROP PRIMARY KEY,
      ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ADD UNIQUE KEY uq_admin_permission_code (permission_code),
      MODIFY permission_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      MODIFY permission_group VARCHAR(32) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_admin_permission_grant
      MODIFY permission_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      MODIFY scope_type VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
      MODIFY scope_key VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      MODIFY status VARCHAR(16) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_admin_authorization_event
      MODIFY event_type VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
      MODIFY role_code VARCHAR(16) COLLATE utf8mb4_bin NULL,
      MODIFY permission_code VARCHAR(64) COLLATE utf8mb4_bin NULL,
      MODIFY scope_type VARCHAR(16) COLLATE utf8mb4_bin NULL,
      MODIFY scope_key VARCHAR(64) COLLATE utf8mb4_bin NULL`,
    `ALTER TABLE cb_vendor_profile_version
      MODIFY category_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      MODIFY review_status VARCHAR(16) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_profile_review_event
      MODIFY decision VARCHAR(16) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_vendor_open_attempt
      MODIFY status VARCHAR(24) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_vendor_session
      MODIFY end_reason VARCHAR(24) COLLATE utf8mb4_bin NULL`,
    `ALTER TABLE cb_session_location
      MODIFY stop_reason VARCHAR(24) COLLATE utf8mb4_bin NULL`,
    `ALTER TABLE cb_location_context
      MODIFY token_hash CHAR(64) COLLATE utf8mb4_bin NOT NULL,
      MODIFY purpose VARCHAR(24) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_feedback_observation
      MODIFY claim_token_hash CHAR(64) COLLATE utf8mb4_bin NULL,
      MODIFY source VARCHAR(24) COLLATE utf8mb4_bin NOT NULL,
      MODIFY event_public_status VARCHAR(24) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_navigation_check
      MODIFY anonymous_session_hash CHAR(64) COLLATE utf8mb4_bin NOT NULL,
      MODIFY decision VARCHAR(24) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_feedback_case
      MODIFY feedback_type VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
      MODIFY status VARCHAR(24) COLLATE utf8mb4_bin NOT NULL,
      MODIFY result_reason_code VARCHAR(64) COLLATE utf8mb4_bin NULL`,
    `ALTER TABLE cb_feedback_fact
      MODIFY feedback_type VARCHAR(32) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_feedback_review_event
      MODIFY result VARCHAR(24) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_feedback_fact_decision
      MODIFY result VARCHAR(24) COLLATE utf8mb4_bin NOT NULL,
      MODIFY reason_code VARCHAR(64) COLLATE utf8mb4_bin NULL`,
    `ALTER TABLE cb_management_action
      MODIFY action_type VARCHAR(32) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_vendor_impact_record
      MODIFY source_type VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
      MODIFY status VARCHAR(24) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_data_clear_request
      MODIFY status VARCHAR(24) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_vendor_impact_review_request
      MODIFY status VARCHAR(24) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_retention_hold
      MODIFY target_type VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
      MODIFY source_type VARCHAR(32) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_audit_event
      MODIFY action_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      MODIFY target_type VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
      MODIFY result_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      MODIFY retention_class VARCHAR(24) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_idempotency_operation
      MODIFY actor_scope VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
      MODIFY operation_type VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      MODIFY key_hash CHAR(64) COLLATE utf8mb4_bin NOT NULL,
      MODIFY request_hash CHAR(64) COLLATE utf8mb4_bin NOT NULL,
      MODIFY status VARCHAR(24) COLLATE utf8mb4_bin NOT NULL`,
    `ALTER TABLE cb_pilot_event
      MODIFY event_type VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      MODIFY dedupe_ref VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
      MODIFY outcome VARCHAR(64) COLLATE utf8mb4_bin NOT NULL`,
  ],
};

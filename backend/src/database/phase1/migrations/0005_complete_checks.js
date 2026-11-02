// 前四个迁移已在隔离库执行；按只增迁移原则补齐质量规范要求的检查约束。
module.exports = {
  description: '补齐一期状态与时间检查约束',
  statements: [
    'ALTER TABLE cb_vendor_open_day ADD CONSTRAINT ck_open_day_version CHECK (state_version > 0)',
    'ALTER TABLE cb_vendor_publication_control ADD CONSTRAINT ck_publication_versions CHECK (self_version > 0 AND governance_version > 0)',
    'ALTER TABLE cb_management_action ADD CONSTRAINT ck_management_reason CHECK (CHAR_LENGTH(TRIM(reason)) > 0)',
    'ALTER TABLE cb_vendor_impact_review_request ADD CONSTRAINT ck_impact_review_version CHECK (task_version > 0)',
    'ALTER TABLE cb_audit_event ADD CONSTRAINT ck_audit_time CHECK (occurred_at_ms >= 0)',
    'ALTER TABLE cb_pilot_event ADD CONSTRAINT ck_pilot_time CHECK (occurred_at_ms >= 0)',
  ],
};

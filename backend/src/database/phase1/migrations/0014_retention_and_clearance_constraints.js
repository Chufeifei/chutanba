// W8：保留挂起需要幂等登记（同一对象同一来源只挂一次），复核申请需要「同一影响只允许一份未结复核」，
// 清除请求与复核状态需要枚举白名单兜底。0004 建表时未带这些约束，本迁移只增约束不改列语义。
module.exports = {
  description: '保留挂起唯一键与清除、复核状态约束',
  statements: [
    `ALTER TABLE cb_retention_hold
      ADD UNIQUE KEY uq_retention_target_source (target_type, target_id, source_type, source_id),
      ADD CONSTRAINT ck_retention_target_type CHECK (target_type IN ('LOCATION_VERSION','FEEDBACK_CASE')),
      ADD CONSTRAINT ck_retention_source_type CHECK (source_type IN ('FEEDBACK_CASE','IMPACT_REVIEW'))`,
    `ALTER TABLE cb_vendor_impact_review_request
      ADD COLUMN pending_impact_record_id BIGINT UNSIGNED GENERATED ALWAYS AS
        (CASE WHEN status = 'PENDING' THEN impact_record_id ELSE NULL END) STORED,
      ADD UNIQUE KEY uq_impact_review_pending (pending_impact_record_id),
      ADD CONSTRAINT ck_impact_review_status CHECK (status IN ('PENDING','UPHELD','REVOKED'))`,
    `ALTER TABLE cb_vendor_impact_record
      ADD CONSTRAINT ck_impact_record_status CHECK (status IN ('ACTIVE','REVOKED'))`,
    `ALTER TABLE cb_data_clear_request
      ADD CONSTRAINT ck_clear_status CHECK (status IN ('QUEUED','IN_PROGRESS','COMPLETED','PARTIAL_FAILED'))`,
  ],
};

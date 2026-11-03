module.exports = {
  description: '公开投影补充导航发起字段与活动轮次索引',
  statements: [
    `ALTER TABLE cb_navigation_check
      ADD COLUMN launched_at_ms BIGINT NULL,
      ADD COLUMN launch_ref CHAR(32) COLLATE utf8mb4_bin NULL,
      ADD UNIQUE KEY uq_navigation_launch_ref (launch_ref)`,
    `ALTER TABLE cb_navigation_check
      ADD CONSTRAINT ck_navigation_launch CHECK (launched_at_ms IS NULL OR launched_at_ms >= created_at_ms)`,
    'ALTER TABLE cb_vendor_session ADD KEY ix_session_active_end (ended_at_ms, planned_end_at_ms)',
  ],
};

// 管理队列跨摊主按 review_status + submitted_at_ms 倒序分页；0001 只有 (vendor_id, review_status)，
// 无法支撑该排序。新增索引只增不改，不触碰已执行的 0001～0010。
module.exports = {
  description: '资料审核管理队列索引',
  statements: [
    `ALTER TABLE cb_vendor_profile_version
      ADD KEY ix_profile_status_submitted (review_status, submitted_at_ms, id)`,
  ],
};

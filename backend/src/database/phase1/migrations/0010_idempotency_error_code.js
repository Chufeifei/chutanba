// FAILED 幂等操作需要稳定错误码；0010 之前该表只有 result_ref，无法回放失败语义。
module.exports = {
  description: '幂等操作记录稳定错误码',
  statements: [
    `ALTER TABLE cb_idempotency_operation
      ADD COLUMN error_code VARCHAR(64) COLLATE utf8mb4_bin NULL`,
  ],
};

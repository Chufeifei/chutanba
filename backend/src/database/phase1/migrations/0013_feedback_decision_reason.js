// W7：管理逐事实结论需要可追溯的说明文字；契约 §5.4 的 reasonText 只做可选补充。
module.exports = {
  description: '反馈逐事实结论补充说明列',
  statements: [
    'ALTER TABLE cb_feedback_fact_decision ADD COLUMN reason_text VARCHAR(500) NULL AFTER reason_code',
  ],
};

/**
 * 反馈域对外出口：提交与本人读模型。
 * 管理侧核实（W7）不在本域，本域只负责事实成立。
 * 位置清单只提供只读方法：影响申诉要挂起这些位置的保留。
 */
const {
  submitFeedback,
  listMyFeedback,
  getMyFeedback,
  findLocationIdsByCaseIdInTransaction,
  listCaseRetentionInTransaction,
} = require('./service');

module.exports = {
  submitFeedback,
  listMyFeedback,
  getMyFeedback,
  findLocationIdsByCaseIdInTransaction,
  listCaseRetentionInTransaction,
};

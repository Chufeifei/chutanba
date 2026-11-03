/**
 * 反馈域对外出口：提交与本人读模型。
 * 管理侧核实（W7）不在本域，本域只负责事实成立。
 */
const { submitFeedback, listMyFeedback, getMyFeedback } = require('./service');

module.exports = { submitFeedback, listMyFeedback, getMyFeedback };

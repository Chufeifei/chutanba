/**
 * 清除域对外出口。
 *
 * 清除请求成立即生效（停公开、结束轮次、冻结待审资料），清理批次逐类幂等；
 * 调度与作业身份属 W12 作业层，本域只提供可被作业调用的领域方法。
 */
const {
  previewClear,
  submitClearRequest,
  listMyRequests,
  getMyRequest,
  runCleanup,
  listQueuedRequests,
} = require('./service');

module.exports = {
  previewClear,
  submitClearRequest,
  listMyRequests,
  getMyRequest,
  runCleanup,
  listQueuedRequests,
};

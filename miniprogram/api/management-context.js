/**
 * 管理入口上下文（契约 §5.4）。
 *
 * 只用于决定 P14 显示哪些任务卡，不构成任何权限：
 * 即使这里返回了某个能力，具体读写仍由服务端按资源逐次鉴权，
 * 旧链接直达页面也必须能显示"无权"结果（AC-13）。
 */
const { get } = require('../utils/request');
const { MANAGEMENT } = require('../config/endpoints');

/** roles / capabilities / queueCounts */
function getManagementContext() {
  return get(MANAGEMENT.CONTEXT);
}

module.exports = { getManagementContext };

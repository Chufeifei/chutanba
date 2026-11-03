const service = require('./service');
const { derivePhase, shanghaiDateKey } = require('./time');
const { MAX_LOCATION_AGE_MS } = require('./geo');
const mapper = require('./mapper');
const { endSessionInTransaction } = require('./service/end');

// 共用纯函数导出：阶段判定（W5）、上海自然日（W6 事件日合并）、定位新鲜度上限与
// 开摊资格投影（W7 管理上下文）。只在此处转出，禁止其他域复制同一份口径。
module.exports = {
  ...service,
  deriveSessionPhase: derivePhase,
  deriveOpenEligibility: mapper.toEligibility,
  // 纠错只结束「调用方已核对并加锁」的指定轮次：终态写入仍走唯一入口，不另开旁路。
  endSessionInTransaction,
  shanghaiDateKey,
  MAX_LOCATION_AGE_MS,
};

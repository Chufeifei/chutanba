const service = require('./service');
const { derivePhase, shanghaiDateKey } = require('./time');
const { MAX_LOCATION_AGE_MS } = require('./geo');

// 共用纯函数导出：阶段判定（W5）、上海自然日（W6 事件日合并）与定位新鲜度上限
// 只在此处转出，禁止其他域复制同一份时间口径。
module.exports = {
  ...service,
  deriveSessionPhase: derivePhase,
  shanghaiDateKey,
  MAX_LOCATION_AGE_MS,
};

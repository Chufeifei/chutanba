const service = require('./service');
const { derivePhase } = require('./time');

// 公开详情与工作台共用同一份阶段判定（R1 同一算法），只增导出，不改既有用例签名。
module.exports = { ...service, deriveSessionPhase: derivePhase };

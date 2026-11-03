/**
 * 影响记录域对外出口：写入只提供事务内入口，读取只提供本人列表。
 * 其他模块不得直接引用本域的 repository / mapper / schema。
 */
const {
  recordInTransaction, listMyImpacts, findImpactIdBySource, IMPACT_REVIEW_WINDOW_MS,
} = require('./service');

module.exports = {
  recordInTransaction, listMyImpacts, findImpactIdBySource, IMPACT_REVIEW_WINDOW_MS,
};

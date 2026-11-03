/**
 * 反馈复核域对外出口：管理列表、详情、决定与当前轮次纠错。
 * 其他模块不得直接引用本域的 repository / mapper / schema。
 */
const { listCases, getCaseDetail } = require('./service');
const { decide } = require('./decide');
const { correctSession } = require('./correction');

module.exports = { listCases, getCaseDetail, decide, correctSession };

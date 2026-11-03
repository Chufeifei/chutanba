/**
 * 管理域对外出口。recordActionInTransaction 供反馈复核在同一事务写处理记录，
 * 保证「决定 + 处理记录 + 影响记录」不可分离。
 */
const service = require('./service');

module.exports = service;

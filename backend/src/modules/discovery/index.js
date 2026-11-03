/**
 * 发现域唯一出口：六个公开用例。
 * 其他模块不得直接 require 本域的 repository / mapper / schema。
 */
const service = require('./service');

module.exports = { ...service };

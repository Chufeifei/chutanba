/**
 * 能力断言（纯函数）：管理入口每次请求都重新读取当前有效授权，
 * 这里只负责「缺能力即拒绝」，不缓存、不推断、不接受客户端声明。
 */
const { DomainError } = require('../../domain/errors');

function assertCapability(capabilities, code) {
  if (!Array.isArray(capabilities) || !capabilities.includes(code)) {
    throw new DomainError('PERMISSION_DENIED');
  }
  return capabilities;
}

function assertAnyCapability(capabilities, codes) {
  if (!Array.isArray(capabilities) || !codes.some((code) => capabilities.includes(code))) {
    throw new DomainError('PERMISSION_DENIED');
  }
  return capabilities;
}

module.exports = { assertCapability, assertAnyCapability };

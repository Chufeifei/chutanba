const { DomainError } = require('../../domain/errors');

/** 身份缺失时不建立匿名账号；公开只读接口不经过本模块。 */
function assertIdentity(identity) {
  if (!identity || !identity.openid) {
    throw new DomainError('AUTH_REQUIRED');
  }
  return identity;
}

module.exports = { assertIdentity };

/**
 * 公开品类目录：只读冻结码表，不查库。
 * 目录缺失或版本为空视为服务不可用，不能返回空目录让客户端以为「一期没有品类」。
 */
const { DomainError } = require('../../../domain/errors');
const { CATEGORIES, VERSION } = require('../categories');
const mapper = require('../mapper');

function getCategories() {
  if (!CATEGORIES || CATEGORIES.length === 0 || !VERSION) {
    throw new DomainError('SERVICE_UNAVAILABLE', '公开品类目录暂不可用');
  }
  return mapper.toCategoryList(CATEGORIES, VERSION);
}

module.exports = { getCategories };

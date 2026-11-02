const { failure } = require('../utils/response');

/** 未匹配到任何路由时统一返回 JSON 信封，而不是 Express 默认的 HTML。 */
function notFound(req, res) {
  return failure(res, {
    httpStatus: 404,
    bizCode: 'RESOURCE_NOT_FOUND',
    msg: '接口不存在',
  });
}

module.exports = notFound;

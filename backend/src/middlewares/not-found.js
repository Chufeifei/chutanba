/** 未匹配到任何路由时，统一返回 JSON，而不是 Express 默认的 HTML。 */
function notFound(req, res) {
  return res.status(404).json({
    code: 404,
    msg: '接口不存在',
  });
}

module.exports = notFound;

/**
 * 响应信封的唯一出口：一期契约 §5 规定成功为 {code,msg,data,requestId}，
 * 失败额外带 bizCode。所有路由与中间件都必须经这里返回，避免各写一套结构。
 */
function success(res, data = null, httpStatus = 200) {
  return res.status(httpStatus).json({
    code: httpStatus,
    msg: 'ok',
    data,
    requestId: res.locals.requestId || null,
  });
}

function failure(res, { httpStatus = 500, bizCode = 'INTERNAL_ERROR', msg, data = null }) {
  return res.status(httpStatus).json({
    code: httpStatus,
    msg,
    bizCode,
    data,
    requestId: res.locals.requestId || null,
  });
}

module.exports = { success, failure };

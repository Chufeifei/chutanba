/**
 * 响应信封标准化。
 *
 * 后端成功体：{ code: 200, msg: 'ok', data: {...}, requestId }
 * 后端错误体：{ code: 409, msg: '可展示说明', bizCode: 'STATE_CONFLICT', data: {...}, requestId }
 * 这里只做结构归一，不判断业务语义 —— 分类属于 utils/failure.js。
 */
function normalizeEnvelope(body, statusCode = 200) {
  if (body && typeof body === 'object' && !Array.isArray(body)
    && ('code' in body || 'data' in body || 'msg' in body)) {
    const code = body.code == null ? statusCode : body.code;
    return {
      code,
      msg: body.msg || body.message || (code >= 200 && code < 300 ? 'ok' : '请求处理失败'),
      bizCode: body.bizCode,
      data: 'data' in body ? body.data : null,
      requestId: body.requestId,
    };
  }
  // 非信封结构（如网关直接返回文本）按整体作为 data 处理，避免页面拿到未知形状
  return {
    code: statusCode,
    msg: statusCode >= 200 && statusCode < 300 ? 'ok' : '请求处理失败',
    bizCode: undefined,
    data: body,
    requestId: undefined,
  };
}

function isSuccessEnvelope(envelope) {
  return Boolean(envelope) && typeof envelope.code === 'number'
    && envelope.code >= 200 && envelope.code < 300;
}

module.exports = { normalizeEnvelope, isSuccessEnvelope };

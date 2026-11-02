const crypto = require('node:crypto');

/**
 * 请求摘要的规范化 JSON：对象键递归排序、数组保持顺序。
 * 同一业务请求无论客户端字段顺序如何，都必须得到相同摘要，否则幂等重放会被误判为异体。
 */
function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson 只接受有限数值');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError('canonicalJson 只接受 JSON 安全值');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

module.exports = { canonicalJson, sha256Hex };

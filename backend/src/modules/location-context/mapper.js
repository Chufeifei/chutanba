/** 定位上下文对外结构：只给令牌、签发与过期时刻，不返回摘要或内部 ID。 */
function toIssued({ token, issuedAtMs, expiresAtMs }) {
  return { locationContextToken: token, issuedAtMs, expiresAtMs };
}

module.exports = { toIssued };

/** 数据库行 → 领域对象；对外只暴露裁剪后的本人上下文。 */
function toAccount(row) {
  return {
    id: Number(row.id),
    openid: row.wx_openid,
    unionid: row.wx_unionid,
    status: row.status,
    version: Number(row.version),
  };
}

function toMe(account, capabilities, vendorId) {
  const result = {
    accountId: String(account.id),
    accountVersion: account.version,
    capabilities,
  };
  // 无摊主时省略 vendorId，避免前端把 null 当成“已绑定但为空”。
  if (vendorId !== null && vendorId !== undefined) {
    result.vendorId = String(vendorId);
  }
  return result;
}

module.exports = { toAccount, toMe };

const { resolveAccount, getMe, clearProfileInTransaction, lockAccountInTransaction } = require('./service');

module.exports = {
  resolveAccount,
  getMe,
  // 清除域（W8）要清账号资料并在事务内锁行比版本：账号域仍是账号表的唯一解释方。
  clearProfileInTransaction,
  lockAccountInTransaction,
};

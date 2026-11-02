const { getPool } = require('./pool');

/**
 * 非事务读取入口。
 * 只接受参数化占位，禁止调用方拼接 SQL；需要写入或事务时走 db/transaction.js。
 */
async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

module.exports = { query };

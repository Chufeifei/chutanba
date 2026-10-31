const { getPool } = require('../config/database');

/** 参数化查询，返回 [rows, fields]。优先用于读取。 */
async function query(sql, params = []) {
  return getPool().query(sql, params);
}

/** 预编译执行，返回 [rows, fields]。优先用于写入/带参数的语句。 */
async function execute(sql, params = []) {
  return getPool().execute(sql, params);
}

/**
 * 事务助手：获取连接、开启事务、执行回调、成功提交、失败回滚。
 * 回调接收连接对象 conn，需用 conn.query / conn.execute 操作同一连接。
 */
async function transaction(fn, pool = getPool()) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function selectForUpdate(connection, tableName, keyColumn, keyValue) {
  if (!/^[a-z0-9_]+$/.test(tableName) || !/^[a-z0-9_]+$/.test(keyColumn)) {
    throw new TypeError('锁定目标标识无效');
  }
  const [rows] = await connection.execute(
    `SELECT * FROM ${tableName} WHERE ${keyColumn} = ? FOR UPDATE`,
    [keyValue],
  );
  return rows[0] || null;
}

module.exports = { query, execute, transaction, selectForUpdate };

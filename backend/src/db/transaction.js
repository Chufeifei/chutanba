const { getPool } = require('./pool');

/**
 * 唯一的事务入口：一个用例一个事务，事务边界只允许出现在 service 层。
 * handler 拿到本次事务的连接，repository 必须复用该连接，否则事务失效。
 */
async function withTransaction(handler) {
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return result;
  } catch (error) {
    // 回滚失败不能覆盖原始错误：排障需要看到真正触发回滚的那一条异常。
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('事务回滚失败', rollbackError);
    }
    throw error;
  } finally {
    // 异常路径漏释放会打满连接池，任何分支都必须执行。
    connection.release();
  }
}

module.exports = { withTransaction };

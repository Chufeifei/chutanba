/**
 * 取主库权威时刻（Unix 毫秒）。
 *
 * 必须由调用方传入本次事务的连接：同一用例内的资格判断、成立时间、审计时间要共用一个 N。
 * 禁止用小程序时钟、应用进程 Date.now() 或后台作业执行时刻判断营业与窗口资格。
 *
 * 表达式先乘 1000 再 CAST：UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) 是带 3 位小数的秒值，
 * 直接 CAST 会截断毫秒。
 */
async function nowMs(executor) {
  if (!executor || typeof executor.execute !== 'function') {
    throw new TypeError('nowMs 需要一个可执行查询的连接或连接池');
  }

  const [rows] = await executor.execute(
    'SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 AS UNSIGNED) AS now_ms',
  );

  return Number(rows[0].now_ms);
}

module.exports = { nowMs };

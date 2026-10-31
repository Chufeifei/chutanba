const mysql = require('mysql2/promise');
const env = require('./env');

let pool;

/**
 * 在第一次真正访问数据库时创建连接池。
 * 这样 GET /api/hello 等不依赖数据库的接口，可以在尚未配置 MySQL 时独立运行和调试。
 */
function getPool() {
  if (pool) {
    return pool;
  }

  const requiredValues = {
    DB_HOST: env.database.host,
    DB_USER: env.database.user,
    DB_NAME: env.database.name,
  };
  const missingNames = Object.entries(requiredValues)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingNames.length > 0) {
    throw new Error(`缺少 MySQL 环境变量：${missingNames.join(', ')}`);
  }

  pool = mysql.createPool({
    host: env.database.host,
    port: env.database.port,
    user: env.database.user,
    password: env.database.password,
    database: env.database.name,
    waitForConnections: true,
    connectionLimit: env.database.connectionLimit,
    queueLimit: 0,
    charset: 'utf8mb4',
    // DATE/TIME 是业务值而非 JS 本地 Date；保持字符串避免驱动时区转换。
    dateStrings: true,
    // 仅在明确启用时使用 TLS。生产环境应根据云 MySQL 的连接要求配置。
    ssl: env.database.ssl ? { rejectUnauthorized: true } : undefined,
  });

  return pool;
}

/** 供启动检查或健康检查验证数据库连接。 */
async function pingDatabase() {
  const database = getPool();
  await database.query('SELECT 1');
}

/** 容器退出前关闭连接池，避免正在使用的连接被直接中断。 */
async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = {
  getPool,
  pingDatabase,
  closeDatabase,
};

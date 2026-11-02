const path = require('node:path');
const dotenv = require('dotenv');

// 明确从 backend 目录读取 .env，避免从不同工作目录启动时加载到错误文件。
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

/**
 * 将环境变量转换为正整数。
 * 端口和连接池大小配置错误时立即抛错，比服务启动后才出现隐蔽故障更容易排查。
 */
function readPositiveInteger(name, fallback) {
  const rawValue = process.env[name] || String(fallback);
  const value = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`环境变量 ${name} 必须是正整数`);
  }

  return value;
}

/** 逗号分隔字符串 → 去空白字符串数组；未配置返回空数组。 */
function readStringList(name) {
  const rawValue = String(process.env[name] || '').trim();
  if (!rawValue) return Object.freeze([]);
  return Object.freeze(
    rawValue
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

// 所有环境变量集中在这里读取，业务代码不直接散落访问 process.env。
const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: readPositiveInteger('PORT', 80),
  database: {
    host: process.env.DB_HOST,
    port: readPositiveInteger('DB_PORT', 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME,
    connectionLimit: readPositiveInteger('DB_CONNECTION_LIMIT', 10),
    ssl: process.env.DB_SSL === 'true',
  },
  identity: {
    // 本地身份模拟必须显式开启；生产环境无论该值如何都忽略 X-Dev-Openid。
    allowDev: process.env.ALLOW_DEV_IDENTITY === 'true',
  },
  authorization: {
    // 管理资格只来自部署配置：客户端无法通过请求体或查询参数获得角色。
    // SUPER_ADMIN 仍然单列，ADMIN 与两类审核员由部署名单幂等同步到角色/权限表。
    superAdminOpenids: readStringList('SUPER_ADMIN_OPENIDS'),
    adminOpenids: readStringList('ADMIN_OPENIDS'),
    profileReviewerOpenids: readStringList('PROFILE_REVIEWER_OPENIDS'),
    fieldReviewerOpenids: readStringList('FIELD_REVIEWER_OPENIDS'),
  },
  jobs: {
    // 调度端点令牌：未配置时调度端点返回 503，宁可不可用也不裸奔。
    triggerToken: process.env.JOB_TRIGGER_TOKEN || null,
    // 单次 HTTP 触发的时间预算，必须小于平台请求超时，避免被掐断留下半截状态。
    timeBudgetMs: readPositiveInteger('JOB_TIME_BUDGET_MS', 20000),
  },
});

module.exports = env;

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

function readJsonObject(name) {
  const rawValue = String(process.env[name] || '').trim();
  if (!rawValue) return Object.freeze({});
  let value;
  try {
    value = JSON.parse(rawValue);
  } catch (_error) {
    throw new Error(`Environment variable ${name} must be a valid JSON object`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Environment variable ${name} must be a JSON object`);
  }
  return Object.freeze({ ...value });
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
  security: {
    qrTokenSecret: process.env.QR_TOKEN_SECRET || (process.env.NODE_ENV === 'production' ? null : 'development-only-change-me'),
    accountPiiKey: process.env.ACCOUNT_PII_KEY || null,
  },
  wechat: {
    appId: process.env.WECHAT_APP_ID || null,
    appSecret: process.env.WECHAT_APP_SECRET || null,
  },
  admin: {
    // 运营写操作白名单（openid，逗号分隔）。为空时运营写能力不开放（503），不裸奔。
    operatorOpenids: readStringList('ADMIN_OPERATOR_OPENIDS'),
  },
  jobs: {
    // 调度端点令牌：未配置时调度端点返回 503，宁可不可用也不裸奔。
    triggerToken: process.env.JOB_TRIGGER_TOKEN || null,
    outboxBatchSize: readPositiveInteger('OUTBOX_BATCH_SIZE', 100),
    // 单次 HTTP 触发的时间预算，必须小于平台请求超时，避免被掐断留下半截状态。
    timeBudgetMs: readPositiveInteger('JOB_TIME_BUDGET_MS', 20000),
  },
  officialAccount: {
    appId: process.env.WECHAT_OA_APP_ID || null,
    appSecret: process.env.WECHAT_OA_APP_SECRET || null,
    callbackToken: process.env.WECHAT_OA_CALLBACK_TOKEN || null,
    encodingAesKey: process.env.WECHAT_OA_ENCODING_AES_KEY || null,
    reservationDigestTemplateId: process.env.WECHAT_OA_RESERVATION_DIGEST_TEMPLATE_ID || null,
    reservationDigestFields: readJsonObject('WECHAT_OA_RESERVATION_DIGEST_FIELDS_JSON'),
    displayName: process.env.WECHAT_OA_DISPLAY_NAME || '',
    qrImageUrl: process.env.WECHAT_OA_QR_IMAGE_URL || '',
    miniProgramAppId: process.env.WECHAT_MINIPROGRAM_APP_ID || process.env.WECHAT_APP_ID || null,
  },
});

module.exports = env;

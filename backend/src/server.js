const app = require('./app');
const env = require('./config/env');
const { closeDatabase, pingDatabase } = require('./config/database');

let server;

async function bootstrap() {
  // 数据库连接为懒加载（首次查询时才建立连接池）。若已配置完整数据库参数，
  // 启动前做一次连通性探测；失败仅告警，不阻断无数据库依赖的架构骨架启动。
  if (env.database.host && env.database.user && env.database.name) {
    try {
      await pingDatabase();
      console.log('数据库连接探测成功');
    } catch (error) {
      console.warn('数据库连接探测失败（非致命，连接为懒加载）：', error.message);
    }
  } else {
    console.warn('未配置完整数据库参数，仅启动无数据库依赖的架构骨架');
  }

  server = app.listen(env.port, '0.0.0.0', () => {
    console.log(`出摊吧后端已启动，监听端口 ${env.port}`);
  });
}

let isShuttingDown = false;

function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(`收到 ${signal}，开始关闭服务`);

  if (!server) {
    process.exit(0);
  }

  server.close(async (serverError) => {
    try {
      await closeDatabase();
      process.exit(serverError ? 1 : 0);
    } catch (databaseError) {
      console.error('关闭 MySQL 连接池失败', databaseError);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error('服务未能在 10 秒内正常关闭，强制退出');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap();

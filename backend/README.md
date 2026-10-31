# 出摊吧云托管后端

基于 Node.js、Express、MySQL 和 Docker 的微信云托管后端骨架。

## 目录结构

```text
backend/
├─ src/
│  ├─ config/       # 环境变量与 MySQL 连接池
│  ├─ controllers/  # 接收请求并组织 HTTP 响应
│  ├─ jobs/         # 可被定时调度或命令行复用的作业实现
│  ├─ middlewares/  # 404、统一错误处理、调度端点鉴权
│  ├─ routes/       # 接口路径定义
│  ├─ services/     # 业务逻辑与数据访问编排
│  ├─ app.js        # Express 应用配置
│  └─ server.js     # 服务启动与优雅退出
├─ .env.example     # 本地环境变量示例
├─ Dockerfile       # 云托管镜像构建文件
└─ package.json     # 后端独立依赖清单
```

## 本地启动

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Windows PowerShell 可使用：

```powershell
Copy-Item .env.example .env
npm run dev
```

访问 `http://localhost:80/api/hello`，响应如下：

```json
{
  "code": 200,
  "msg": "Hello Cloud Run!"
}
```

健康检查地址为 `GET /health`。

## 小程序切换本地服务

小程序不能直接读取 `backend/.env`。如需本地联调，先在 `backend/.env` 中记录：

```dotenv
PORT=3000
MINIPROGRAM_LOCAL_BASE_URL=http://127.0.0.1:3000
```

再把相同地址填入 `miniprogram/config/cloud.js` 的 `localBaseUrl`，将 `serviceName` 设置为空字符串，并为
`localDevOpenid` 填写一个仅用于本地联调的固定用户标识。
`serviceName` 有值时统一请求工具无条件使用 `wx.cloud.callContainer`；只有 `serviceName` 为空且
`localBaseUrl` 非空时才改用 `wx.request`。本地请求会携带 `X-Dev-Openid`，该身份头仅在后端
`NODE_ENV` 不是 `production` 时有效。使用 HTTP 本地地址时，需要在开发者工具的本地设置中
勾选“不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”；真机不能使用 `localhost`，
需要使用电脑的局域网 IP。

## Docker 验证

```bash
docker build -t chutanba-backend .
docker run --rm -p 8080:80 --env-file .env chutanba-backend
```

随后访问 `http://localhost:8080/api/hello`。

## 定时调度

提醒投递与「自动收摊 / 请假生效 / 预约汇总 / 信用日结」等时间驱动行为，必须由外部定时触发。
服务是多副本部署，**不要在容器内跑 cron**（每个副本都会各跑一遍，导致重复发提醒）；
改由云托管定时触发器调用下面的 HTTP 端点，平台单点发起。

| 方法 | 路径 | 作用 |
|---|---|---|
| `POST` | `/internal/jobs/core` | 时间驱动状态推进（自动收摊、请假生效/到期、汇总窗口封口、过期作废、信用日结、留存作业） |
| `POST` | `/internal/jobs/outbox` | 投递待发提醒（开摊提醒、请假取消提醒、预约汇总） |
| `POST` | `/internal/jobs/run-all` | 先 `core` 再 `outbox`，只配一个定时任务时用它 |

鉴权：请求头 `X-Job-Token: <JOB_TRIGGER_TOKEN>` 或 `Authorization: Bearer <JOB_TRIGGER_TOKEN>`。
未配置 `JOB_TRIGGER_TOKEN` 时端点统一返回 `503`（宁可不可用，也不允许匿名触发作业），
令牌不匹配返回 `401`。端点不接受微信用户身份。

建议每 5 分钟调用一次 `/internal/jobs/run-all`。单次执行有 20 秒时间预算（`JOB_TIME_BUDGET_MS`），
跑不完会在返回摘要中标记 `budgetExhausted: true` 并主动收手，剩余部分由下一次调度继续处理。

本地手动执行等价命令（脚本与端点共用 `src/jobs/` 下同一份实现）：

```bash
npm run jobs:core:once
npm run outbox:once
```

详细配置步骤与验收清单见 `docs/06-实现与联调/release-checklist.md` §9。

## 云托管配置

1. 将云托管服务的构建目录设置为本 `backend` 目录。
2. 容器端口设置为 `80`。
3. 在云托管控制台配置 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`、`JOB_TRIGGER_TOKEN` 等环境变量。
4. 配置定时触发器调用 `/internal/jobs/run-all`，并带上 `X-Job-Token` 请求头。
5. 不要上传本地 `.env`，数据库密码与调度令牌只通过云端环境变量管理。

> `scripts/` 目录不会被打进镜像（`Dockerfile` 只 `COPY src ./src`），仅用于本地/CI 手动执行。

`GET /api/hello` 不访问数据库。需要操作 MySQL 的 Service 可从 `src/config/database.js` 引入 `getPool()`，并优先使用参数化查询或 `execute()` 防止 SQL 注入。

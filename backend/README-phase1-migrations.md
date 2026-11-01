# 一期空库迁移

一期 W1 使用独立目录 `src/database/phase1/migrations/` 和元数据表
`cb_phase1_schema_migrations`。默认命令不加载旧 `src/database/migrations/`
或旧迁移运行器；旧文件仅保留作源码历史。旧业务服务尚未接入一期表，
迁移完成不代表应用可以上线。W5 必须关闭旧公开坐标路由或接入统一公开投影。

## 初始化与状态

在 `backend` 目录执行（Node.js >=20）：

```powershell
npm run migrate:status
npm run migrate
npm run migrate:status
```

命令沿用 `src/config/env.js`，读取 `backend/.env` 和进程环境中的
`DB_HOST`、`DB_PORT`（默认 3306）、`DB_USER`、`DB_PASSWORD`、`DB_NAME`、
`DB_CONNECTION_LIMIT` 和 `DB_SSL`。先确认这些配置指向新建的隔离空库；
本任务不授权操作生产库。运行器将迁移连接会话固定为 UTC，DDL 使用 InnoDB、utf8mb4，
无物理外键。目标 MySQL 8 的精确版本仍须核实并执行下述验证。

首次迁移会拒绝任何非元数据表，包括旧库只有 `cb_vendor_locations` 的情况，
不会导入旧数据或兼容旧迁移历史。按文件名顺序执行四个迁移，记录 SHA-256 校验和，
使用连接级命名锁防止并行迁移；已应用文件不得改写。重复执行不会重新应用已记录迁移。
状态命令只读，JSON 报告 `applied`、`pending`、`drift`、`failed`、
`incompatibleTables`、`compatible`；待执行但兼容时退出 0，不兼容时退出 2，
执行错误退出 1。迁移执行错误退出 1。

MySQL DDL 隐式提交。中途失败会报告迁移名，元数据可能留在 `RUNNING`，
已经执行的 DDL 不会自动回滚。检查错误与实际表结构后，人工重建一次性隔离库再验证；
不要直接删除失败记录或更改校验和来跳过检查。运行器不会替你删除数据库。

## 表与契约对应

权威字段与业务规则见 `../doc/一期数据模型与接口约定.md` §2–3。

| 文件 | 表职责 |
| --- | --- |
| `0001_identity_profile.js` | 账号、管理授权、摊主、不可变资料版本、审核事件 |
| `0002_sessions_locations.js` | 营业轮次、开摊意图、位置版本、出摊日、双公开限制、定位上下文 |
| `0003_feedback_governance.js` | 观察、导航复核、反馈事项／事实／审核／逐事实决定、管理行为、本人影响记录、影响复核 |
| `0004_clearance_audit.js` | 清除申请、保留依据、审计、幂等操作、试点事件 |

可空生成列与唯一索引限制同摊主单待审资料、单未结束轮次及同轮单未停止位置。
经纬度为 `DECIMAL(10,7)`／`DECIMAL(11,7)`；公开资格、时间窗口、引用完整性、
权限与各领域事务仍由后续工作包实现。字段容量不代表 G-01 表单规则已冻结。

## 隔离 MySQL 验证

先人工准备目标精确版本的 MySQL 8 和一个全新空库，名称必须以 `phase1_test_` 开头。
验证工具不读取 `.env` 或普通 `DB_*`，只读取显式测试配置：

```powershell
$env:PHASE1_TEST_HOST = '127.0.0.1'
$env:PHASE1_TEST_PORT = '3306'
$env:PHASE1_TEST_DATABASE = 'phase1_test_w1'
$env:PHASE1_TEST_USER = 'isolated_test_user'
$env:PHASE1_TEST_PASSWORD = '<通过本地安全环境注入>'
$env:PHASE1_TEST_MYSQL_VERSION = '<实际目标精确版本，例如 8.0.36>'
$env:PHASE1_TEST_ISOLATED = 'YES'
npm run migrate:verify
# 或从仓库根目录执行同一套集成检查：
node --test backend/test/phase1-schema.integration.test.js
```

不要先对该测试库执行 `migrate`；验证工具要求空库并自行完成迁移、重跑、状态、
临时迁移副本漂移、并发唯一约束、CHECK、DECIMAL、BIGINT、字符集和 UTC 检查。
工具会插入测试数据且不会自动删库；重跑前人工重建空库。保存不含凭据的版本、库名、
迁移清单和检查结果。未配置测试库时 CLI 退出 2，集成测试显示跳过，均不代表验收通过。

无需数据库的检查（仓库根目录）：

```powershell
npm --prefix backend run check
node --test backend/test/*.test.js
```

当前没有目标版本隔离 MySQL 的通过证据；W1 数据库验收保持待完成。

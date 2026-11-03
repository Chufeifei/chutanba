# 一期迁移与隔离验证

`npm run migrate` 与 `npm run migrate:status` 只读取 `src/database/phase1/migrations/`。首次迁移仅接受空库；已有非一期表时直接拒绝。迁移以名称和 SHA-256 校验和登记在 `cb_schema_migrations`。MySQL DDL 可能部分提交，失败后须检查并处理残留结构，不能按自动回滚处理。

## 迁移命令

在 `backend/` 目录配置 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME` 后，从仓库根目录运行：

```powershell
npm --prefix backend run migrate:status
npm --prefix backend run migrate
npm --prefix backend run migrate:status
```

执行前必须确认 `DB_NAME` 指向预期目标。W1 验证只使用 `phase1_test_w1`，不对应用库 `chutanba` 执行迁移。迁移运行器将连接会话时区设为 UTC，不修改服务器全局时区。

## W1 隔离库验证

验证器仅读取 `PHASE1_TEST_*`，不会自动读取应用 `DB_*`，也不会创建或删除数据库。提供 `PHASE1_TEST_DATABASE=phase1_test_w1`、`PHASE1_TEST_ISOLATED=YES`、精确的 `PHASE1_TEST_MYSQL_VERSION`、主机、端口及测试账号凭据后，运行：

```powershell
npm --prefix backend run migrate:verify
```

验证器先拒绝非空库、错误库名、版本不符、非 `utf8mb4` 或非严格 SQL 模式，再按序执行全部一期迁移（当前 `0001`–`0011`）、重复执行、漂移检查、表与索引核对、并发唯一性、坐标与 `CHECK`、大整数往返、`utf8mb4_bin` 标识列和 Unicode 往返检查。它会保留迁移表和合成测试数据以供检查。测试凭据只通过环境变量提供，不写入命令输出或记录。

`phase1_test_w1` 可供后续一期集成验证复用。需要再次验证“空库首次迁移”时，必须先确认目标仍是该隔离库，并受控清理上次测试结构；不能把已有表的状态当作空库结果。清理不由验证器自动执行。已执行的迁移文件不可就地修改，后续结构调整应新增迁移。

## W2 隔离库验证

W2 使用与 W1 同一 MySQL 实例的新建隔离库 `phase1_test_w2`，不重置 `phase1_test_w1`，也不对应用库 `chutanba` 执行任何迁移。`0008`–`0010` 只增量补充权限目录种子、授权人可空与幂等错误码；验证器按目录顺序自动包含全部一期迁移。集成用例只读取 `PHASE1_TEST_*`（主机、端口、账号、密码与 `PHASE1_TEST_DATABASE=phase1_test_w2`），凭据缺失时跳过，不会回退到 `DB_*`。

## W3 隔离库验证

W3 使用同一 MySQL 实例的新建隔离库 `phase1_test_w3`，不重置 `phase1_test_w1`／`phase1_test_w2`，也不对应用库 `chutanba` 执行任何迁移。`0011` 只为资料审核管理队列新增 `ix_profile_status_submitted (review_status, submitted_at_ms, id)` 索引，不修改 `0001`–`0010`。集成用例同样只读取 `PHASE1_TEST_*`（`PHASE1_TEST_DATABASE=phase1_test_w3`），凭据缺失时跳过，不会回退到 `DB_*`。

## W4 隔离库验证

W4 无迁移，使用同一 MySQL 实例的新建隔离库 `phase1_test_w4`，不重置 `phase1_test_w1`／`w2`／`w3`，也不对应用库 `chutanba` 执行任何迁移。建库命令（`utf8mb4`，与 `w3` 一致）：

```sql
CREATE DATABASE phase1_test_w4 CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

随后用 `DB_NAME=phase1_test_w4` 连跑两遍 `npm --prefix backend run migrate`（第二遍应全部 `skipped`），再运行集成用例：

```powershell
$env:PHASE1_TEST_DATABASE='phase1_test_w4'
$env:PHASE1_TEST_HOST='...'; $env:PHASE1_TEST_PORT='...'
$env:PHASE1_TEST_USER='...'; $env:PHASE1_TEST_PASSWORD='...'
$env:LOCATION_CONTEXT_SECRET='w4-test-secret'
node --test backend/test/w4-sessions-publication.integration.test.js
```

### 本机 TCP 回环被代理接管时

若开着代理 TUN（如 Clash），集成测试会出现「连未监听端口立刻 `ECONNREFUSED`、连已监听端口 `ETIMEDOUT`」的现象，
这是本机网络拦截而不是业务失败。加 `PHASE1_TEST_HTTP_PIPE=1` 改用 Windows 命名管道跑同一批断言：

```powershell
$env:PHASE1_TEST_HTTP_PIPE='1'
node --test backend/test/w4-sessions-publication.integration.test.js
```

## 本地应用库 `chutanba_app` 与演示数据

应用库 `chutanba` 自 2026-11-01 起停留在旧结构：迁移表是旧名 `cb_phase1_schema_migrations`，
只有 `0001`、`0002` 两条记录，`cb_session_location` 无 `active_session_id`，
`cb_navigation_check`、`cb_feedback_observation` 等表不存在。当前代码连它会直接 500
（`Unknown column 'l.active_session_id'`）；现有 runner 使用新表名 `cb_schema_migrations`，
无法识别该库已有状态，因此不能对该库直接续跑迁移。

本地开发改用同实例的空库 `chutanba_app`（与 `phase1_test_*` 隔离，不触碰 `chutanba`）：

```sql
CREATE DATABASE chutanba_app CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

```powershell
$env:DB_NAME='chutanba_app'
npm --prefix backend run migrate          # 首遍 0001-0012 全部 applied
npm --prefix backend run migrate          # 第二遍应全部 skipped
```

演示数据由脚本按资格谓词逐条构造，避免手写 SQL 漏条件导致列表为空或详情 `UNVIEWABLE`：

```powershell
$env:DB_NAME='chutanba_app'
node backend/scripts/seed-demo-public-vendors.js           # 幂等写入，已存在则跳过
node backend/scripts/seed-demo-public-vendors.js --reset   # 先清理上次的 DEMO 对象再写入
```

脚本自带护栏：拒绝在 `DB_NAME=chutanba` 上执行，且只清理 `vendor_code` 以 `DEMO` 开头的对象。
写入后公开集合应有 `DEMO0001`、`DEMO0002`、`DEMO0003` 三个摊位；`DEMO0004` 为已收摊，
只在详情返回 `RESTING`，且响应不含任何坐标。

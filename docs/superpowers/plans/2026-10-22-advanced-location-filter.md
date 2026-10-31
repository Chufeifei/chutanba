---
change: advanced-location-filter
design-doc: openspec/changes/advanced-location-filter/design.md
base-ref: 34796b1f0243b22a3d3b14ceb1a7e075b65b619c
---

# advanced-location-filter 实现计划

<!-- comet-task-authority: openspec/changes/advanced-location-filter/tasks.md -->

需求与行为契约以 `openspec/changes/advanced-location-filter/specs/advanced-location-filter/spec.md` 为准；技术决策以 `openspec/changes/advanced-location-filter/design.md` 为准。本计划只说明实施方法与验证方式，不重述需求。

## 实施基线事实（已核验）

- `backend/src/routes/index.js` 为空聚合器；`backend/src/domain/` 仅 `errors.js`；`backend/src/database/migrations/` 为空。
- `backend/src/db/query.js` 提供 `query / execute / transaction / selectForUpdate`；`backend/src/utils/response.js` 提供 `ok / fail / AppError`；`backend/src/domain/errors.js` 提供 `errors.validation / forbidden / notFound / conflict`。
- `backend/src/database/migration-runner.js` 要求迁移文件名匹配 `^\d{4}_[a-z0-9_]+\.js$`、导出非空 `statements` 数组。
- `miniprogram/utils/request.js` 提供 `get/post/put/remove`，`miniprogram/api/core-v2.js` 提供 `withIdempotency`；响应信封 `{ code, msg, data }`。
- `miniprogram/utils/view-state.js` 八态含 `permission` 与 `empty`，可承载定位拒绝与无公开位置空结果。
- `miniprogram/app.json` 的 `pages` 为空数组，筛选入口需新建并注册页面。
- `tests/` 为空目录；根 `npm test` 的 `validate:vnext-schema` 依赖 `docs/db/vnext/*`（当前缺失），故本批的测试命令为 `node --test tests/*.test.js`，`validate:vnext-schema` 失败属仓库既有断裂，不作为本批证据。
- `docs/superpowers/specs/2026-09-16-vnext-database-design.md`（状态 PROPOSED）已定义 `cb_vendor_locations` 承担"当前/最近公开位置、公开截止、停止公开与保留状态"，并规定：单列主键 `BIGINT UNSIGNED AUTO_INCREMENT`、坐标只用 `DECIMAL`、绝对时刻用 UTC 毫秒 `BIGINT UNSIGNED`、业务时区固定 `Asia/Shanghai`、不建物理外键但保留关联列索引与逻辑关系登记。本批对齐该基线。

## 范围与依赖边界

本批交付两件权威事实：**区域字典**（平台自定义经营片区，圆形边界）与**摊主公开位置**（含公开截止与停止公开状态），以及以位置资格为驱动的发现列表筛选。

摊主的名称、图片、品类与公开状态分别由 `cb_vendor_profile_versions`、`cb_vendor_states` 等依赖批次拥有，这些表在当前仓库不存在。本批的筛选查询**以位置为驱动**，返回位置资格与距离；摊主展示字段的 join 目标按逻辑关系登记，留待依赖批次落地后接入，不在本批伪造资料表。

**已知缺口（写入 design.md Known Gaps，不在本批宣称满足）**：

1. 内部信用分排序缺失 —— `credit-business-tags` 未实施，完整排序口径中的信用分项不可实现。
2. 兼容矩阵未定（ISSUE-02）—— 本批不依赖外部地图 SDK，不做真机兼容矩阵验收。
3. 埋点口径未定（ISSUE-03）—— 本批不新增埋点，不采集顾客精确位置用于分析。

## 1. 契约与已有实现核验

<!-- comet-task-ref:45e16a67-160a-4960-8e84-bf5b1e8d8476 -->
<!-- comet-task-ref:c63e4d7a-56fb-4eb6-9b5f-98fd52526f94 -->

- 产出 `openspec/changes/advanced-location-filter/traceability.md`：以表格逐条列出 FR-CUST-13.01~.04、BR-LOC-01~BR-LOC-18 中与位置筛选相关的条款、AC-18/AC-29、NFR-P-03/P-08、NFR-PR-01/02/07、NFR-R-15 与本批 spec Requirement / 场景 / 任务 / 验证证据的映射，并标注每条的来源文件与行号。
- 核验记录写入同一文档的「已有实现与保留范围」一节：列出本批需新建的 6 个后端文件族与 4 个小程序文件族，以及明确不触碰的既有文件（`backend/src/app.js`、`backend/src/server.js`、`miniprogram/app.js`、`miniprogram/utils/request.js`）。
- 验收：矩阵中每条 FR/BR/NFR/AC 均有对应 spec 条款或明确的"本批不适用 + 理由"，无空缺行。

## 2. 分项实现

### 2.1 数据模型与迁移

<!-- comet-task-ref:a97b4114-051d-441b-b8d4-1117265b2aaa -->

- `backend/src/database/migrations/0001_create_cb_location_region.js`：建 `cb_location_region`。
  - 列：`id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`、`region_code VARCHAR(64) NOT NULL`（唯一）、`region_name VARCHAR(128) NOT NULL`、`city_code VARCHAR(32) NOT NULL`、`center_lat DECIMAL(10,7) NOT NULL`、`center_lng DECIMAL(11,7) NOT NULL`、`radius_m INT UNSIGNED NOT NULL`、`status VARCHAR(16) NOT NULL`（`ENABLED`/`DISABLED`）、`sort_order INT NOT NULL DEFAULT 0`、`idempotency_key VARCHAR(128) NULL`、`created_at_ms BIGINT UNSIGNED NOT NULL`、`updated_at_ms BIGINT UNSIGNED NOT NULL`。
  - 索引：`UNIQUE KEY uk_cb_location_region_code`、`KEY idx_cb_location_region_status (status, sort_order)`、`KEY idx_cb_location_region_idempotency (idempotency_key)`。
- `backend/src/database/migrations/0002_create_cb_vendor_locations.js`：建 `cb_vendor_locations`。
  - 列：`id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`、`vendor_id BIGINT UNSIGNED NOT NULL`、`location_kind VARCHAR(32) NOT NULL`（`CURRENT_NAVIGATION`/`RECENT_LAST`）、`lat DECIMAL(10,7) NOT NULL`、`lng DECIMAL(11,7) NOT NULL`、`location_name VARCHAR(255) NOT NULL`、`region_id BIGINT UNSIGNED NULL`、`public_until_ms BIGINT UNSIGNED NOT NULL`、`public_status VARCHAR(16) NOT NULL`（`PUBLIC`/`STOPPED`/`EXPIRED`）、`published_at_ms BIGINT UNSIGNED NOT NULL`、`stopped_at_ms BIGINT UNSIGNED NULL`、`created_at_ms BIGINT UNSIGNED NOT NULL`、`updated_at_ms BIGINT UNSIGNED NOT NULL`。
  - 索引：`KEY idx_cb_vendor_locations_vendor (vendor_id, public_status)`、`KEY idx_cb_vendor_locations_region (region_id, public_status)`、`KEY idx_cb_vendor_locations_until (public_status, public_until_ms)`。
  - 逻辑关系登记：位置与摊主、位置与区域，均不建物理外键。
- 约束：不使用 `FLOAT`/`DOUBLE` 存坐标；不建物理外键。
- RED：先写 `tests/location-schema.test.js`，断言迁移文件导出非空 `statements`、表名与列名/类型符合上述约定、索引齐全；此时迁移文件不存在 → 失败。
- GREEN：实现两个迁移文件后测试通过。
- 验收：`node --test tests/location-schema.test.js`。

### 2.2 领域服务：公开资格、公开期、落区

<!-- comet-task-ref:bfe6a819-69fa-401f-a759-a31e7eb49403 -->
<!-- comet-task-ref:3f1c067a-e7f0-45a9-930b-af11bab667bf -->

- 新建 `backend/src/domain/location/public-position.js`（纯函数，无 IO，可单测）：
  - `computePublicUntilMs({ lastLocatedAtMs, businessTimezone })` —— 返回最后一次成功营业定位时刻起第 7 日相同本地时刻的 UTC 毫秒；左闭右开由使用侧 `>=` 语义表达。
  - `isPositionPublic({ publicStatus, publicUntilMs, nowMs })` —— 仅 `PUBLIC` 且 `nowMs < publicUntilMs` 为公开；截止时刻立即为不公开。
  - `resolveRegion({ point, regions })` —— 对启用区域计算 `ST_Distance_Sphere` 等价距离（应用侧 Haversine，注入距离函数以便单测），取距离最小且 ≤ `radius_m` 的区域；无匹配返回 `null`。
  - `distanceMeters(a, b)` —— Haversine，单位米，供单测与距离兜底使用。
- 新建 `backend/src/domain/location/location-service.js`（事务边界与权威写入）：
  - `publishPosition({ vendorId, locationKind, lat, lng, locationName, lastLocatedAtMs, nowMs })` —— 同一事务内写位置记录并完成落区（`region_id`），保证单一权威写入边界。
  - `stopPublicPosition({ vendorId, nowMs })` —— 置 `public_status=STOPPED` 并写 `stopped_at_ms`；已停止或已到期不得恢复。
  - `expirePositions({ nowMs, batchSize })` —— 把 `public_status='PUBLIC'` 且 `public_until_ms <= nowMs` 的记录条件更新为 `EXPIRED`；重复执行结果一致。
  - `listPublicLocations({ regionId, origin, radiusM, nowMs })` —— 以位置为驱动的候选查询：`public_status='PUBLIC' AND public_until_ms > nowMs` 为前置条件；给出 `regionId` 时加 `region_id = ?`；给出 `origin + radiusM` 时加 `ST_Distance_Sphere(...) <= radiusM`（边界含端点）。
- 新建 `backend/src/domain/region/region-service.js`：
  - `listEnabledRegions()` —— 返回启用区域（ID、名称、所属城市），不含坐标与半径。
  - `createRegion / updateRegion / setRegionStatus` —— 管理端写操作，校验经纬度范围与半径上下限，幂等键由路由层注入。
- 业务时区常量置于 `backend/src/config/business-time.js`，固定 `Asia/Shanghai`，不开放为可调环境变量。
- RED：先写 `tests/location-domain.test.js`，覆盖 `computePublicUntilMs`（8 月 1 日 18:00 → 8 月 8 日 18:00）、`isPositionPublic`（截止时刻即刻失效、已停止不公开）、`resolveRegion`（恰好等于半径命中、超过半径不命中、无启用区域返回 null）、`distanceMeters`（已知两点距离）→ 失败。
- GREEN：实现后通过。
- 验收：`node --test tests/location-domain.test.js`。

### 2.3 路由与接口

<!-- comet-task-ref:a97b4114-051d-441b-b8d4-1117265b2aaa -->

- 新建 `backend/src/routes/v2/regions.js`：`GET /api/v2/regions` → 启用区域列表。
- 新建 `backend/src/routes/v2/vendors.js`：`GET /api/v2/vendors` → 发现列表。参数：关键词、品类、`status`、`regionId`、`lat`、`lng`、`radiusM`。校验规则：`radiusM` 存在而 `lat`/`lng` 缺失 → `VALIDATION_FAILED`（422），不得静默忽略；`lat`/`lng` 越界 → `VALIDATION_FAILED`；`radiusM` 非正整数 → `VALIDATION_FAILED`。
- 新建 `backend/src/routes/v2/admin-regions.js`：`POST/PUT/DELETE /api/v2/admin/regions`，写操作经 `withIdempotency` 注入 `Idempotency-Key` 与 `X-Request-Id`；删除为停用（`DISABLED`），不物理删除。
- 装配：`backend/src/routes/index.js` 挂载 `/api/v2`。
- 响应：统一 `{ code, msg, data }`，业务错误用 `AppError`/`errors.*`，HTTP 风格 code。
- 身份：沿用 `attachIdentity`，只信任平台注入身份；顾客端接口不读请求体中的身份字段。
- RED：先写 `tests/location-routes.test.js`，用可注入的假服务验证参数校验与响应信封（半径缺位置 → 422；越界坐标 → 422；正常 → 200 且 `data.items` 结构固定）→ 失败。
- GREEN：实现后通过。
- 验收：`node --test tests/location-routes.test.js`。

### 2.4 小程序端契约与筛选入口页面

<!-- comet-task-ref:a4e4cc47-59d3-45e6-81bc-d881d663b613 -->

- `miniprogram/api/contracts.js`：新增 `LOCATION_KIND`、`LOCATION_PUBLIC_STATUS`、`REGION_STATUS` 三个冻结枚举。
- `miniprogram/api/regions.js`：新增 `listRegions()`。
- `miniprogram/api/discover.js`：`listVendors` 扩展位置筛选参数透传（`regionId`/`lat`/`lng`/`radiusM`），保持 `get` 透传形态。
- 新建 `miniprogram/pages/discover/`（`index.js`/`index.json`/`index.wxml`/`index.wxss`）：区域选择（读 `listRegions`）、半径输入、已选条件展示、结果列表、加载/空/权限/可重试失败四态。
  - 定位仅在用户主动使用半径筛选时请求（`wx.getLocation`）；拒绝授权 → 降级为仅区域筛选并呈 `permission` 态，不发起位置请求。
  - 提供半径但未取得位置 → 本地拦截并提示，不发请求。
- `miniprogram/app.json`：`pages` 注册该页；保留既有 `usingComponents`、`permission`、`requiredPrivateInfos`。
- RED：先写 `tests/location-contracts.test.js`，断言枚举取值、`listVendors` 参数透传形状、页面在无位置时不含定位调用路径 → 失败。
- GREEN：实现后通过。
- 验收：`node --test tests/location-contracts.test.js`；`npm run check:static` 全绿。

### 2.5 公开期失效与到期处理

<!-- comet-task-ref:3f1c067a-e7f0-45a9-930b-af11bab667bf -->

- 到期失效由读时过滤保证正确性（查询侧 `public_until_ms > nowMs`），定时任务只做终态化与审计。
- 新建 `backend/scripts/run-location-expiry-once.js`：调用 `expirePositions`，可重复执行，输出处理条数 JSON。
- 缓存策略：位置相关查询不做跨请求缓存；写操作不产生需失效的缓存键（无缓存层时直接不引入）。
- RED：在 `tests/location-domain.test.js` 追加"到期后读时立即排除"与"重复执行失效任务结果一致"的断言 → 失败。
- GREEN：实现后通过。
- 验收：`node --test tests/location-domain.test.js`。

## 3. 联合验证与交付资料

<!-- comet-task-ref:3a88ebcf-e769-4374-a86a-0d52d6c6a6eb -->
<!-- comet-task-ref:869136ac-fe52-4eec-933b-340a20a95471 -->
<!-- comet-task-ref:f9f1a044-1c27-4655-a971-f158befa3fe0 -->

- 3.1 跨角色链路核对：以追踪矩阵为索引，逐条确认 spec 场景有实现与测试证据；覆盖区域筛选（无顾客位置）、半径筛选（需顾客位置）、无公开位置排除、主动停止公开后立即退出、到期后退出。
- 3.2 权限/隐私/性能/时效核对：停止公开后顾客端不可读坐标与导航入口；顾客精确位置只用于当次距离计算；错误反馈可理解且不泄露内部信息；列出本批未具备的外部环境验证（真机定位、真实 MySQL spatial 函数、兼容矩阵）并明确标记为未验证，不虚报通过。
- 3.3 交付资料：更新 `docs/superpowers/reports/` 下的本批验证报告与 `openspec/changes/advanced-location-filter/traceability.md`；完成独立集成审查（由独立审查者执行，不由实现者自评）。
- 验收证据：`node --test tests/*.test.js` 全绿；`npm run check:static` 全绿；`comet check run advanced-location-filter build --local -- node --test tests/*.test.js` 录制 build 证据后运行阶段守卫。

## 风险与回退

- 真实 MySQL 8 的 `ST_Distance_Sphere` 可用性未在本环境实测（无数据库连接配置）。回退方案：切换为应用侧 Haversine，保持同一口径与"边界含端点"约定，`distanceMeters` 已作为该路径的单一实现点。
- 区域调整后历史位置不自动重算：属既定取舍，管理端变更需配套批量重算，不在读路径隐式重算。
- 摊主资料表缺失导致列表不含展示字段：属依赖边界，已在 Known Gaps 声明，不伪造资料表。

## 回退策略

新增迁移不回滚既有表；停用本批入口与到期脚本即可下线功能，位置与区域数据保留供审计。已形成的审计与业务事实不做逆向删除。

# 出摊吧小程序架构（一期 MVP）

> 状态：**架构层已落地，业务层未开发**。本文只描述"代码放哪里、谁依赖谁、边界在哪"，不含业务流程实现。
> 依据：`doc/MVP/一期MVP需求文档.md`（业务口径）、`一期页面与交互方案.md`（P01～P18）、`一期技术设计.md`（权威状态与同步）、`一期数据模型与接口约定.md`（HTTP 契约）、`.trellis/spec/frontend/`（编码规范，本文与其一致）。

---

## 1. 这套架构要解决什么

一期有三个硬约束，决定了架构形态：

| 约束 | 来源 | 对架构的要求 |
|---|---|---|
| 18 类页面、10 种可见状态 | 页面方案 §3、技术设计 §9 | 状态判定必须只有一处，页面只渲染 |
| 所有前台页面最多 60 秒同步、断网标"未更新" | 需求 R-01、AC-18 | 同步流程必须只写一遍 |
| 写操作超时必须查结果、不能重发 | 技术设计 §4.3、AC-08 | 幂等键生命周期必须统一管理 |

如果这三件事分散在 18 个页面里各写一份，任何一条需求变更都要改 18 处，且必然漏。这是重构的唯一理由。

---

## 2. 分层与依赖方向

依赖方向的**唯一裁决依据**是
[.trellis/spec/frontend/directory-structure.md](../../.trellis/spec/frontend/directory-structure.md) 第二节：
单向依赖 `pages ──▶ services ──▶ api ──▶ utils/request ──▶ config`，外加 `behaviors/`、`store/`、`utils/`，
含完整的可依赖矩阵与三条红线。本文不重复维护该矩阵，避免两份规则漂移。

本文只留一条判据：**改动跨层（页面 + service + api 同时改）就必须走正式流程并跑 Quality Check。**

---

## 3. 目录结构（含当前落地状态）

图例：**✅ 已落地** ｜ **⬜ 待建（架构已定位置，业务未写）**

```
miniprogram/
├── app.js ✅                    云开发初始化
├── app.json ✅                  页面注册 + custom tabBar + 位置权限声明
├── app.wxss ✅                  设计变量（颜色/圆角/间距），页面不写字面量色值
├── sitemap.json ✅
│
├── config/                     常量与环境，无逻辑
│   ├── cloud.js ✅              envId / serviceName / localBaseUrl / localDevOpenid
│   ├── env.js ✅                用微信 envVersion 判生产
│   ├── endpoints.js ✅          30+ 接口路径单一来源（带 id 的用函数生成）
│   ├── contracts.js ✅          一期业务枚举 + BIZ_CODE + 字段长度上限
│   ├── timing.js ✅             轮询间隔、12h 上限、30 分钟窗口、300m、5min
│   └── categories.js ✅         品类树与 6 个查询函数
│
├── utils/                      纯函数与传输，不得依赖上层
│   ├── request.js ✅            只做传输（不含拆信封、不含业务判断）
│   ├── envelope.js ✅           响应信封标准化
│   ├── failure.js ✅            错误分类 + toViewState + toWriteOutcome
│   ├── view-state.js ✅         10 态状态机
│   ├── action-key.js ✅         操作键生成与本地暂存（含 TTL）
│   ├── clock.js ✅              上海时区时间计算（只用于显示）
│   ├── location.js ✅           wx.getLocation 封装 + 失败分类
│   ├── navigation.js ✅         wx.openLocation 唯一出口
│   ├── formatter.js ✅          距离/时间/文本格式化
│   └── action-resume.js ✅      跳转恢复（参数已收窄，禁止存坐标与证据）
│
├── api/                        一个函数 = 一个后端接口，零业务
│   ├── core-v2.js ✅            写命令包装（缺幂等键直接抛错）
│   ├── public.js ✅             品类 / 公开集合 / 详情 / 观察 / 导航复核与发起
│   ├── me.js ✅                 本人快照 / 定位上下文 / 操作结果查询
│   ├── feedback.js ✅           观察绑定 / 候选轮次 / 提交与本人记录
│   ├── data-clear.js ✅         清除预览与请求
│   ├── impact.js ✅             本人影响记录与人工复核
│   ├── vendor-profile.js ✅     资料读取与提交
│   ├── vendor-session.js ✅     工作台 / 开摊尝试 / 开摊 / 刷新 / 收摊 / 出摊日
│   ├── vendor-publication.js ✅ 本人停止与恢复公开
│   ├── management-context.js ✅ 管理入口上下文
│   ├── management-profile.js ✅ 资料审核
│   ├── management-feedback.js ✅ 现场复核与当前纠错
│   ├── management-governance.js ✅ 治理与审计
│   └── management-impact.js ✅  资料争议与影响复核
│
├── services/                   业务编排，域目录（含 mapper / rules）
│   ├── submission/ ✅           ★ 写命令唯一出口（幂等键 + 结果查询）
│   ├── account/ ✅              /me 整形 + 写回 store
│   ├── discover/ ✅             公开集合取数、品类过滤、距离排序、空态归因
│   ├── detail/ ✅               详情投影、休息/不可查看的分支
│   ├── navigation/ ✅           ★ 导航复核编排（唯一能拿坐标给 wx 的地方）
│   ├── feedback/ ✅             候选窗口、提交、本人记录
│   ├── profile/ ⬜              资料申请与审核状态
│   ├── workbench/ ⬜            工作台快照、开摊/刷新/收摊编排
│   ├── publication/ ⬜          两类限制的读取与操作
│   ├── clearance/ ⬜            清除预览与进度
│   └── management/ ⬜           审核 / 复核 / 治理 / 争议的队列与命令
│
├── store/                      跨页共享态，只存纯数据
│   └── identity.js ✅           本人身份、资格、capabilities（入口可见性唯一来源）
│
├── behaviors/                  页面生命周期级复用
│   ├── live-refresh.js ✅       ★ R-01：复核 + 轮询 + 去重 + 丢过时 + 失败标 stale
│   └── form-submit.js ✅        提交中的六种可见结果（含"结果未知"）
│
├── components/                 受控组件，不取数
│   ├── state-view/ ✅           10 态统一渲染（图标/配色集中在此）
│   ├── confirm-sheet/ ✅        承接 D01～D08 弹层
│   ├── fixed-cta/ ✅            底部主次操作
│   ├── status-dot/ ✅           状态文字 + 色点
│   ├── vendor-card/ ✅          列表项与地图摘要卡共用
│   ├── phase-badge/ ✅          正常营业 / 准备收摊 / 休息
│   ├── countdown/ ✅            剩余时间（只显示，不判定）
│   ├── category-picker/ ✅      P01 与 P08 共用
│   └── form-field/ ⬜           字段 + 错误定位
│
├── pages/                      见第 6 节映射表
│   ├── discover/ ✅             P01
│   └── mine/ ✅                 P03
│
├── packageManagement/ ⬜        管理端独立分包（P14～P18）
├── assets/icons/feather/ ✅     20 个图标
└── custom-tab-bar/ ✅           两入口：找摊 / 我的
```

---

## 4. 三个唯一出口

一期最容易出错的三个点，都用分层强制收口，不靠"记得遵守"。

### 4.1 写命令：`services/submission`

```
页面 ──▶ services/<域> ──▶ submission.runWrite() ──▶ api（带 idempotencyKey）
                                  │
                                  └─▶ 超时/网络异常 → UNKNOWN，保留键
                                        └─▶ queryOutcome() 用同一个键查结果
```

| 结果 | 含义 | 页面该做什么 |
|---|---|---|
| `SUCCEEDED` | 服务端已成立 | 清键，读取最新状态 |
| `UNKNOWN` | 不知道成不成立 | **禁止显示失败**，给"查看最新结果"入口 |
| `CONFLICT` | 版本或状态已变 | 先读最新结果，让用户重新决定 |
| `INVALID` | 字段错误 | 保留输入，定位到原项 |
| `FAILED` | 确定未成立 | 允许用户再次发起（键已清） |

关键设计：**键只在确定结果时清除**。UNKNOWN 和可重试的 FAILED 都保留键，用户再点一次时服务端按同键去重，而不是生成第二次真实业务。

### 4.2 导航：`utils/navigation` + `services/navigation`

`openFromLaunch()` 只接受 navigation-launches 响应里的坐标。列表、详情、本地缓存的坐标在类型上就进不来 —— 这不是靠注释约束，而是靠函数签名。

对应需求 C-02.5 / AC-18：每次新发起导航都要在线复核，缓存坐标一律无效。

### 4.3 同步：`behaviors/live-refresh`

| 需求 | 本文件中的对应实现 |
|---|---|
| 恢复前台先复核 | `onShow` 立即 `refreshLiveNow()` |
| 最多 60 秒同步 | 页面传 `intervalMs`（P01/P02 约 2s，工作台 15～30s） |
| 离开前台停止 | `onHide` 停轮询 |
| 请求不叠加 | 在途请求直接复用，不新建 |
| 丢弃过时响应 | 序号比对，落后即丢弃 |
| 断网标"未更新" | 失败置 `liveSyncState = 'stale'`，页面据此禁用新导航 |
| 网络恢复即复核 | `wx.onNetworkStatusChange` 监听 |

页面只提供 `fetcher` 和 `onResult`，不关心上面任何一条。

---

## 5. 可见状态机（10 态）

依据技术设计 §9。页面只渲染，不做判断；错误一律经 `utils/failure.js` 的 `toViewState` 转换。

| 状态 | 何时用 | 禁止的行为 |
|---|---|---|
| `loading` | 首次加载，尚无内容 | 不得提前显示"没有摊位" |
| `content` | 有内容可渲染 | — |
| `empty` | 服务端明确返回"无当前营业 / 无记录" | 不得用示例摊位填充 |
| `stale` | **已显示内容，但无法确认现在是否仍成立** | 不得新发起导航、开摊等依赖新鲜状态的动作用 |
| `permission` | 无权限 / 身份不可识别 | 不得展示受限内容 |
| `retryable-error` | 读取失败，可重试 | 不得伪装成空结果 |
| `terminal-error` | 对象不存在、窗口已关闭、资格不足 | 不得允许继续原操作 |
| `write-pending` | 写操作处理中 | 不得允许重复点击 |
| `write-unknown` | **写结果未知** | 不得声称成功或失败，必须提供查询入口 |
| `conflict` | 版本或状态已变化 | 不得按旧页面继续处理 |

最容易混的两组：`stale` ≠ `retryable-error`（前者已有内容、后者没有）；`write-unknown` ≠ 写失败（前者可能已成立）。

---

## 6. 页面落位与分包

| 编号 | 页面 | 目录 | 分包 | 状态 |
|---|---|---|---|---|
| P01 | 找摊（列表/地图同页） | `pages/discover/` | 主包 | 已接入（W9） |
| P02 | 摊主详情 | `pages/vendor-detail/` | 主包 | 已接入（W9） |
| P03 | 我的 | `pages/mine/` | 主包 | 骨架（无数据接入） |
| P04 | 现场反馈中心 | `pages/feedback-candidates/` | 主包 | 已接入（W9） |
| P05 | 填写现场反馈 | `pages/feedback-form/` | 主包 | 已接入（W9） |
| P06 | 反馈结果 | `pages/feedback-result/` | 主包 | 已接入（W9） |
| P07 | 摊主资料 | `pages/vendor-profile/` | 主包 | 占位页 |
| P08 | 资料申请/修改 | `pages/vendor-profile-edit/` | 主包 | 占位页 |
| P09 | 摊主工作台 | `pages/workbench/` | 主包 | 占位页 |
| P10 | 出摊记录 | `pages/open-days/` | 主包 | 占位页 |
| P11 | 公开与资料处理 | `pages/publication/` | 主包 | 占位页 |
| P12 | 资料清除 | `pages/data-clear/` | 主包 | 占位页 |
| P13 | 处理记录/人工复核 | `pages/impact-records/` | 主包 | 占位页 |
| P14 | 管理入口 | `packageManagement/pages/index/` | **分包** | 占位页 |
| P15 | 资料审核 | `packageManagement/pages/profile-review/` | **分包** | 占位页 |
| P16 | 现场反馈复核 | `packageManagement/pages/field-review/` | **分包** | 占位页 |
| P17 | 治理处理 | `packageManagement/pages/governance/` | **分包** | 占位页 |
| P18 | 资料争议/人工复核 | `packageManagement/pages/impact-review/` | **分包** | 占位页 |

18 个目录已全部落地，`app.json` 已注册（主包 13 + 分包 5）。占位页只渲染一个空态，不含接口调用与业务判断。

分包理由：管理端只有少数人用，主包只保留顾客 + 摊主的 13 页，缩短首次打开时间。`app.json` 中的配置：

```json
"subPackages": [
  { "root": "packageManagement", "name": "management",
    "pages": ["pages/index/index", "pages/profile-review/index",
              "pages/field-review/index", "pages/governance/index",
              "pages/impact-review/index"] }
]
```

注意两点：
1. 管理入口在 `pages/mine/`，属于主包，跳到分包页用 `wx.navigateTo`，不能用 `switchTab`；
2. 分包内引用上层模块的相对路径是 `../../../utils/xxx`（比主包多一层），已按此生成。

---

## 7. 复用资产清单

清单只有一个来源：[.trellis/spec/frontend/hook-guidelines.md](../../.trellis/spec/frontend/hook-guidelines.md) 第六节，
本文不再重复。新增功能前先查该表，不要造第二份同类实现。

---

## 8. 新增功能时的落位步骤

新增页面和业务域按 [.trellis/spec/frontend/directory-structure.md](../../.trellis/spec/frontend/directory-structure.md) 第三节落位；接口与写请求按同目录的职责表和 [quality-guidelines.md](../../.trellis/spec/frontend/quality-guidelines.md) 执行。具体业务能力是否进入一期，以需求文档为准。

---

## 9. 架构红线（评审时逐条对照）

架构红线以 [.trellis/spec/frontend/quality-guidelines.md](../../.trellis/spec/frontend/quality-guidelines.md) 的禁止项和必备项为准；依赖方向以 [directory-structure.md](../../.trellis/spec/frontend/directory-structure.md) 的矩阵为准。执行 [.trellis/spec/frontend/index.md](../../.trellis/spec/frontend/index.md) 的 Quality Check，并结合 review 判断脚本未覆盖的情形。

---

## 10. 完成度

| 层 | 状态 | 说明 |
|---|---|---|
| config | ✅ 完成 | 6 个文件，环境/路径/枚举/阈值/品类全部收口 |
| utils | ✅ 完成 | 10 个文件，纯函数与传输 |
| api | ✅ 完成 | 14 个文件，覆盖契约 §5 全部端点，无业务逻辑 |
| 三个唯一出口 | ✅ 完成 | submission / navigation / live-refresh 已就位 |
| store | ✅ 完成 | identity |
| behaviors | ✅ 完成 | live-refresh / form-submit |
| 页面目录 | ✅ 完成 | 18 / 18 目录与路由就位（主包 13 + 分包 5） |
| 分包 | ✅ 完成 | `packageManagement` 已启用 |
| components | 部分 | 8 个组件可用；`form-field` 待随 P08 建 |
| services | 部分 | 6 / 10 域（submission、account、discover、detail、navigation、feedback）；profile/workbench/publication/clearance/management 待建 |
| pages 业务实现 | 进行中 | P01、P02、P04～P06 已接入（W9）；P03 骨架；其余空态占位 |

**未做**：P03、P07～P18 的页面流程与对应 service 域，属 W10～W11。

---

## 11. 部署前必改

| 项 | 位置 | 现状 |
|---|---|---|
| 云托管服务名 | `config/cloud.js` 的 `serviceName` | 空（走本地联调）。上线前填服务名并清空 `localBaseUrl` |
| 环境 ID | `config/cloud.js` 的 `envId` | 已填 `cloud1-d8g02pi8zeb282ff3`，需与云开发控制台核对 |
| 本地联调 | 微信开发者工具 | 需关闭「校验合法域名」，否则 `http://127.0.0.1:3000` 被拦 |
| 真机联调 | `localBaseUrl` | 不能用 localhost，需改成电脑局域网 IP |

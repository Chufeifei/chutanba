/**
 * 时间相关常量集中管理。
 *
 * 每个值都对应一期需求或技术设计的明确口径；页面和 service 一律引用这里，
 * 不允许就地写字面量，否则阈值改动会散落在多处。
 */

// 前台公开结果同步：技术设计 §5 的候选值是约 2 秒短轮询，最终以实测容量为准
const PUBLIC_POLL_MS = 2000;

// 摊主工作台同步：同一文档给出的 15～30 秒区间，取下界换取更快的到期反馈
const WORKBENCH_POLL_MS = 15000;

// 需求 R-01：已打开且处于前台的相关页面最多 60 秒同步一次，作为兜底上限
const MAX_SYNC_AGE_MS = 60000;

// 需求 V-02：本轮预计收摊时间从实际开摊到截止不超过 12 小时
const MAX_SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

// 需求 V-02：默认推荐当前时间后 4 小时，并向上取整到最近的 30 分钟
const DEFAULT_SESSION_DURATION_MS = 4 * 60 * 60 * 1000;
const SESSION_ROUND_STEP_MS = 30 * 60 * 1000;

// 需求 C-03：反馈受理窗口在原轮次实际结束后 30 分钟关闭（到点即关闭，不含端点）
const FEEDBACK_WINDOW_MS = 30 * 60 * 1000;

// 需求 C-03 / AC-15：提交时本次定位距提交不超过 5 分钟，距原营业位置不超过 300 米
const FEEDBACK_LOCATION_MAX_AGE_MS = 5 * 60 * 1000;
const FEEDBACK_MAX_DISTANCE_M = 300;

// 定位上下文有效期：与服务端签发到接收的 5 分钟窗口保持一致
const LOCATION_CONTEXT_TTL_MS = 5 * 60 * 1000;

// 待恢复操作标识本地保留时长：只用于"上次操作未完成"的短时恢复，不做业务凭据
const OPERATION_KEY_TTL_MS = 10 * 60 * 1000;

// 请求超时：超过该时长未拿到响应即视为"结果未知"，须按原键查询而不是换键重发
const REQUEST_TIMEOUT_MS = 15000;

module.exports = {
  PUBLIC_POLL_MS,
  WORKBENCH_POLL_MS,
  MAX_SYNC_AGE_MS,
  MAX_SESSION_DURATION_MS,
  DEFAULT_SESSION_DURATION_MS,
  SESSION_ROUND_STEP_MS,
  FEEDBACK_WINDOW_MS,
  FEEDBACK_LOCATION_MAX_AGE_MS,
  FEEDBACK_MAX_DISTANCE_M,
  LOCATION_CONTEXT_TTL_MS,
  OPERATION_KEY_TTL_MS,
  REQUEST_TIMEOUT_MS,
};

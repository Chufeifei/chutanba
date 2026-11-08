/**
 * 后端接口路径单一来源（依据 doc/MVP/一期数据模型与接口约定.md §5）。
 *
 * 规则：
 * 1. api/ 层只从这里取路径，不在函数里拼字符串；
 * 2. 带 {id} 的路径一律用函数生成，避免模板字符串散落各处；
 * 3. 全部路径以 /api/v2 为前缀，这是后端唯一挂载前缀。
 */
const BASE = '/api/v2';

// 顾客公开接口：无身份也可访问，服务端按统一公开投影返回
const PUBLIC = {
  CATEGORIES: `${BASE}/public/categories`,
  VENDOR_SEARCH: `${BASE}/public/vendors/search`,
  VENDOR_DETAIL: (vendorId) => `${BASE}/public/vendors/${vendorId}`,
  VENDOR_OBSERVATIONS: (vendorId) => `${BASE}/public/vendors/${vendorId}/observations`,
  NAVIGATION_CHECK: (vendorId) => `${BASE}/public/vendors/${vendorId}/navigation-check`,
  NAVIGATION_LAUNCHES: `${BASE}/public/navigation-launches`,
};

// 本人账号与共用命令：身份快照、定位上下文、操作结果查询
const ME = {
  PROFILE: `${BASE}/me`,
  LOCATION_CONTEXTS: `${BASE}/me/location-contexts`,
  // 网络超时后按原操作键查询结果，不能换键重发
  OPERATION: (operationType, key) => `${BASE}/me/operations/${operationType}/${key}`,
  OBSERVATION_CLAIM: `${BASE}/me/observations/claim`,
  FEEDBACK_CANDIDATES: `${BASE}/me/feedback-candidates`,
  FIELD_FEEDBACK: `${BASE}/me/field-feedback`,
  FIELD_FEEDBACK_DETAIL: (feedbackId) => `${BASE}/me/field-feedback/${feedbackId}`,
  DATA_CLEAR_PREVIEW: `${BASE}/me/data-clear-preview`,
  DATA_CLEAR_REQUESTS: `${BASE}/me/data-clear-requests`,
  DATA_CLEAR_REQUEST_DETAIL: (requestId) => `${BASE}/me/data-clear-requests/${requestId}`,
  IMPACT_RECORDS: `${BASE}/me/impact-records`,
  IMPACT_REVIEWS: `${BASE}/me/impact-reviews`,
  IMPACT_REVIEW_DETAIL: (reviewId) => `${BASE}/me/impact-reviews/${reviewId}`,
};

// 摊主本人接口：资料、营业轮次、出摊日、公开控制
const VENDOR = {
  PROFILE: `${BASE}/vendor/profile`,
  PROFILE_SUBMISSIONS: `${BASE}/vendor/profile-submissions`,
  PROFILE_SUBMISSION_DETAIL: (submissionId) => `${BASE}/vendor/profile-submissions/${submissionId}`,
  WORKBENCH: `${BASE}/vendor/workbench`,
  OPEN_ATTEMPTS: `${BASE}/vendor/open-attempts`,
  OPEN_ATTEMPT_FINISH: (attemptId) => `${BASE}/vendor/open-attempts/${attemptId}/finish`,
  SESSIONS_OPEN: `${BASE}/vendor/sessions/open`,
  SESSION_LOCATIONS: (sessionId) => `${BASE}/vendor/sessions/${sessionId}/locations`,
  SESSION_CLOSE: (sessionId) => `${BASE}/vendor/sessions/${sessionId}/close`,
  OPEN_DAYS: `${BASE}/vendor/open-days`,
  PUBLICATION: `${BASE}/vendor/publication`,
  PUBLICATION_STOP: `${BASE}/vendor/publication/stop`,
  PUBLICATION_RESUME: `${BASE}/vendor/publication/resume`,
};

// 管理端接口：每次由服务端重新鉴权，入口可见性不构成权限
const MANAGEMENT = {
  CONTEXT: `${BASE}/management/context`,
  PROFILE_REVIEWS: `${BASE}/management/profile-reviews`,
  PROFILE_REVIEW_DETAIL: (reviewId) => `${BASE}/management/profile-reviews/${reviewId}`,
  PROFILE_REVIEW_DECISION: (reviewId) => `${BASE}/management/profile-reviews/${reviewId}/decision`,
  FIELD_FEEDBACK: `${BASE}/management/field-feedback`,
  FIELD_FEEDBACK_DETAIL: (caseId) => `${BASE}/management/field-feedback/${caseId}`,
  FIELD_FEEDBACK_DECISION: (caseId) => `${BASE}/management/field-feedback/${caseId}/decision`,
  SESSION_CORRECTIONS: (sessionId) => `${BASE}/management/sessions/${sessionId}/corrections`,
  VENDORS: `${BASE}/management/vendors`,
  GOVERNANCE_CONTEXT: (vendorId) => `${BASE}/management/vendors/${vendorId}/governance-context`,
  GOVERNANCE_DECISIONS: (vendorId) => `${BASE}/management/vendors/${vendorId}/governance-decisions`,
  IMPACT_REVIEWS: `${BASE}/management/impact-reviews`,
  IMPACT_REVIEW_DETAIL: (reviewId) => `${BASE}/management/impact-reviews/${reviewId}`,
  IMPACT_REVIEW_DECISION: (reviewId) => `${BASE}/management/impact-reviews/${reviewId}/decision`,
};

module.exports = { BASE, PUBLIC, ME, VENDOR, MANAGEMENT };

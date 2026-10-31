const { get, post, put } = require('../utils/request');
const { withIdempotency, idempotencyKey } = require('./core-v2');

async function me() {
  const response = await get('/api/v2/management/context');
  return { ...response, data: { ...response.data, role: String(response.data.grant.role_code).toLowerCase() } };
}

async function workbench() {
  const response = await get('/api/v2/management/workbench');
  const data = response.data || {};
  return {
    ...response,
    data: {
      ...data,
      counts: {
        profileAudits: (data.profiles || []).length,
        feedbacks: (data.feedback || []).length,
        governanceCases: (data.governanceCases || []).length,
      },
    },
  };
}

function listProfileReviews() {
  return get('/api/v2/management/profile-reviews');
}

function getProfileReview(reviewTaskId) {
  return get(`/api/v2/management/profile-reviews/${reviewTaskId}`);
}

function reviewProfile(id, body) {
  return withIdempotency(post, `/api/v2/management/profile-reviews/${id}/decision`, {
    decision: body.status,
    reason: body.note,
    ruleOrModelVersion: 'manual-v2.20',
  }, 'profile-review');
}

function reviewAppeal(reviewTaskId, body) {
  return reviewProfile(reviewTaskId, body);
}

function reviewFeedback(id, body) {
  // body.result 直接映射后端枚举：CONFIRMED / NOT_CONFIRMED / INSUFFICIENT / DUPLICATE_MERGED
  const result = body.result
    || (body.status === 'REVIEWED' ? 'CONFIRMED' : 'NOT_CONFIRMED');
  return withIdempotency(post, `/api/v2/management/field-feedback/${id}/decision`, {
    result,
    reason: body.note,
  }, 'feedback-review');
}

function listFeedbackReviews(status = 'ALL') {
  return get('/api/v2/management/field-feedback', { status });
}

function handleReport(id, body) {
  return post(`/api/v2/management/reports/${id}/decision`, {
    result: body.status === 'REVIEWED' ? 'CONFIRMED' : 'NOT_CONFIRMED',
    reason: body.note,
  });
}

async function listRules() {
  const response = await get('/api/v2/management/credit-policy');
  const policy = response.data;
  const rows = Object.entries(policy.rules_json || {}).map(([key, value]) => ({
    config_key: key,
    config_value: String(value),
    updated_at: policy.published_at_ms,
  }));
  return { ...response, data: rows };
}

function updateRules(body) {
  const numeric = Number(body.value);
  const value = Number.isFinite(numeric) ? numeric : body.value;
  return post('/api/v2/management/credit-policy/versions', {
    key: body.key,
    value,
    impactDescription: `管理端调整规则 ${body.key}`,
    userNoticeReference: `management-console:${Date.now()}`,
  });
}

async function listAdmins() {
  const response = await get('/api/v2/management/grants');
  return {
    ...response,
    data: (response.data || []).map((item) => ({
      ...item,
      id: item.management_grant_id,
      user_id: item.account_id,
      openid: item.wx_openid,
      role: String(item.role_code || '').toLowerCase(),
      created_at: item.valid_from_ms,
      scopes: item.scopes || [],
    })),
  };
}

function changeGrant(grantId, body) {
  return post(`/api/v2/management/grants/${grantId}/actions`, body);
}

function replaceGrantScopes(grantId, scopes, reason) {
  return put(`/api/v2/management/grants/${grantId}/scopes`, { scopes, reason });
}

const AUDIT_ACTION_LABELS = {
  PROFILE_REVIEW_DECIDED: '资料审核', FIELD_FEEDBACK_REVIEWED: '反馈复核',
  GOVERNANCE_SUSPEND_PUBLIC: '暂停公开', GOVERNANCE_RESTORE_PUBLIC: '恢复公开',
  VENDOR_OPENED: '开始出摊', VENDOR_CLOSED: '结束出摊',
  VENDOR_AUTO_CLOSED: '自动收摊', VENDOR_LEAVE_CLOSED: '请假收摊', VENDOR_GOVERNANCE_CLOSED: '治理收摊',
};
const AUDIT_TARGET_LABELS = { PROFILE_REVIEW: '资料审核', FIELD_FEEDBACK: '现场反馈', VENDOR: '摊主' };

async function listAudit(params = {}) {
  const response = await get('/api/v2/management/audit-events', params);
  const data = response.data || {};
  const rows = (data.rows || []).map((item) => ({
    ...item,
    id: item.id || `AUDIT:${item.audit_event_id}`,
    action: item.action_code,
    actionLabel: AUDIT_ACTION_LABELS[item.action_code] || '关键操作',
    admin_openid: `账号 #${item.actor_account_id || 'SYSTEM'}`,
    target: `${item.target_type}:${item.target_id}`,
    created_at: item.occurred_at_ms,
  }));
  return { ...response, data: { ...data, rows } };
}

function decideCreditAppeal(id, body) {
  return post(`/api/v2/management/credit-appeals/${id}/decision`, {
    decision: body.status === 'APPROVED' ? 'REVOKED' : 'MAINTAINED',
    reason: body.note || '管理端复核结论',
  });
}

function createInvitation(body) {
  return post('/api/v2/management/invitations', {
    targetOpenid: body.targetOpenid,
    targetAccountId: body.targetAccountId,
    roleCode: String(body.role || body.roleCode).toUpperCase(),
    expiresAtMs: body.expiresAt || body.expiresAtMs,
    scopes: body.scopes || [],
    reason: body.reason || '管理人员邀请',
  });
}

async function listInvitations(params = {}) {
  const response = await get('/api/v2/management/invitations', params);
  const data = response.data || {};
  return {
    ...response,
    data: {
      ...data,
      rows: (data.rows || []).map((item) => ({
        ...item,
        target_openid: `账号 #${item.target_account_id}`,
      })),
    },
  };
}

async function searchVendors(keyword) {
  const response = await get('/api/v2/management/vendors', { keyword: keyword || '', limit: 20 });
  return { ...response, data: response.data || [] };
}

function governanceVendorDetail(vendorId) {
  return get(`/api/v2/management/vendors/${vendorId}/governance-context`);
}

async function addGovernanceAction(body) {
  const mapping = {
    pause_public: { caseType: 'PUBLIC_SUSPENSION', decisionType: 'SUSPEND_PUBLIC' },
    restore_public: { caseType: 'PUBLIC_SUSPENSION', decisionType: 'RESTORE_PUBLIC' },
  }[body.type];
  if (!mapping) throw new Error('不支持的治理动作');
  const stableKey = `gov:${body.targetUserId}:${mapping.decisionType}:${body.expectedStateVersion}`.slice(0, 64);
  const created = await post('/api/v2/management/governance-cases', {
    vendorId: body.targetUserId,
    caseType: mapping.caseType,
    sourceType: 'MVP_MANAGEMENT',
    sourceId: stableKey,
  });
  return withIdempotency(post, '/api/v2/management/governance-decisions', {
    governanceCaseId: created.data.governanceCaseId,
    vendorId: body.targetUserId,
    decisionType: mapping.decisionType,
    reason: body.reason || '管理端治理决定',
    expectedStateVersion: body.expectedStateVersion,
  }, 'governance', { idempotencyKey: stableKey });
}

async function listGovernanceActions() {
  const response = await get('/api/v2/management/governance-cases');
  return {
    ...response,
    data: (response.data || []).map((item) => ({
      ...item,
      id: item.governance_case_id,
      type: item.decision_type || item.case_type,
      target_user_id: item.vendor_id,
      created_at: item.effective_at_ms || item.opened_at_ms,
    })),
  };
}

async function listStickerApplications() {
  const response = await get('/api/v2/management/sticker-requests');
  return {
    ...response,
    data: (response.data || []).map((item) => ({
      ...item,
      id: item.sticker_request_id,
      vendor_user_id: item.vendor_id,
      name: item.request_type === 'ON_SITE_PRINT' ? '现场领取' : '已加密收件人',
      address: item.request_type === 'ON_SITE_PRINT' ? '不采集邮寄信息' : '地址已加密',
    })),
  };
}
function fulfillSticker(id, body) {
  const status = body.status === 'DONE' ? 'COMPLETED' : body.status;
  return post(`/api/v2/management/sticker-requests/${id}/status`, { status, reason: body.tracking || '管理端履约' });
}

async function executeDeregistration(vendorId) {
  const created = await post('/api/v2/management/governance-cases', {
    vendorId,
    caseType: 'PERMANENT_DEACTIVATION',
    sourceType: 'MANAGEMENT_CONSOLE',
    sourceId: idempotencyKey('deactivation-source'),
  });
  return withIdempotency(post, '/api/v2/management/governance-decisions', {
    governanceCaseId: created.data.governanceCaseId,
    vendorId,
    decisionType: 'PERMANENTLY_DEACTIVATE',
    reason: '最高权限管理员确认永久注销',
  }, 'permanent-deactivation');
}

module.exports = {
  me, workbench, listProfileReviews, getProfileReview, reviewProfile,
  listFeedbackReviews, reviewFeedback, handleReport, listRules, updateRules,
  listAdmins, listAudit, reviewAppeal, decideCreditAppeal, createInvitation, listInvitations,
  changeGrant, replaceGrantScopes, addGovernanceAction, listGovernanceActions, listStickerApplications, fulfillSticker,
  searchVendors, governanceVendorDetail, executeDeregistration,
};

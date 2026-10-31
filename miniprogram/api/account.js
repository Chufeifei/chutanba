const { get, post, put } = require('../utils/request');

/** 我的中心：用户身份概览与是否已成摊主。 */
async function getMyCenter() {
  const response = await get('/api/v2/me');
  const source = response.data;
  return {
    ...response,
    data: {
      nickname: source.display.name,
      accountNickname: source.account.nickname,
      identityLabel: source.display.identityLabel,
      avatarUrl: source.account.avatar_url,
      phoneMasked: source.account.phone_masked,
      role: source.account.current_identity === 'VENDOR' ? 1 : 0,
      vendor: source.vendor,
      authorizations: source.authorizations || {},
    },
  };
}

/** 授权状态：是否已完成微信授权。 */
function getAuthStatus() {
  return get('/api/v2/me');
}

/** 身份切换：在顾客(0)与摊主(1)之间切换视图。 */
function switchIdentity(role) {
  return put('/api/v2/me/identity', { identity: role === 1 || role === 'VENDOR' ? 'VENDOR' : 'CUSTOMER' });
}

/** 接受管理角色邀请。 */
function acceptInvitation(token) {
  return post('/api/v2/management/invitations/accept', { token });
}

function listPendingInvitations() {
  return get('/api/v2/management/invitations/pending');
}

function respondInvitation(invitationId, decision) {
  return post('/api/v2/management/invitations/respond', { invitationId, decision });
}

function updateAuthorization(type, status, value) {
  return put(`/api/v2/me/authorizations/${type}`, {
    status,
    value,
    sourceActionId: `account-profile:${type}:${Date.now()}`,
  });
}

function authorizePhone(code) {
  return post('/api/v2/me/authorizations/phone/exchange', {
    code,
    sourceActionId: `account-profile:phone:${Date.now()}`,
  });
}

function revokePhone() {
  return post('/api/v2/me/authorizations/phone/revoke', {
    sourceActionId: `account-profile:phone-revoke:${Date.now()}`,
  });
}

module.exports = {
  getMyCenter,
  getAuthStatus,
  switchIdentity,
  acceptInvitation,
  listPendingInvitations,
  respondInvitation,
  updateAuthorization,
  authorizePhone,
  revokePhone,
};

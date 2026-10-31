const { get, post, put } = require('../utils/request');
const { withIdempotency } = require('./core-v2');

/** 营业状态概览：状态/请假计划/出摊天数。 */
function getStatus() {
  return get('/api/v2/vendor/workbench');
}

/** 一键出摊。 */
function openStall(payload) {
  return withIdempotency(post, '/api/v2/vendor/sessions/open', payload, 'open');
}

function closeStall(sessionId, vendorId) {
  return withIdempotency(post, `/api/v2/vendor/sessions/${sessionId}/close`, { vendorId }, 'close');
}

function extendStall(sessionId, vendorId, hours = 1) {
  return withIdempotency(post, `/api/v2/vendor/sessions/${sessionId}/extend`, { vendorId, hours }, 'extend');
}

/** 今日请假（快速键）。 */
function todayLeave() {
  return withIdempotency(post, '/api/v2/vendor/leave', { leaveType: 'TODAY' }, 'leave-today');
}

function leaveImpact(payload = {}) {
  const query = Object.entries(payload).filter(([, value]) => value != null)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  return get(`/api/v2/vendor/leave/impact${query ? `?${query}` : ''}`);
}

function closeImpact(sessionId) {
  return get(`/api/v2/vendor/sessions/${sessionId}/close-impact`);
}

/** 计划请假（开始/结束日）。 */
function plannedLeave(payload) {
  return withIdempotency(post, '/api/v2/vendor/leave', {
    leaveType: payload.endDate ? 'DATE_RANGE' : 'INDEFINITE',
    ...payload,
  }, 'leave-plan');
}

/** 取消请假。 */
function cancelLeave() {
  return withIdempotency(post, '/api/v2/vendor/leave/end', {}, 'leave-end');
}

function updatePlannedLeave(leavePeriodId, payload) {
  return withIdempotency(post, `/api/v2/vendor/leave/${leavePeriodId}/update`, payload, 'leave-update');
}

function cancelPlannedLeave(leavePeriodId) {
  return withIdempotency(post, `/api/v2/vendor/leave/${leavePeriodId}/cancel`, {}, 'leave-cancel');
}

/** 更新实时位置。 */
function updateLocation(payload) {
  return withIdempotency(post, '/api/v2/vendor/location/refresh', payload, 'location');
}

/** 出摊天数记录。 */
function getAttendance() {
  return get('/api/v2/vendor/workbench');
}

function getNotificationChannel() {
  return get('/api/v2/vendor/notification-channel');
}

function updateNotificationChannel(enabled) {
  return put('/api/v2/vendor/notification-channel', { enabled });
}

module.exports = {
  getStatus, openStall, closeStall, extendStall, todayLeave, leaveImpact, closeImpact, plannedLeave,
  updatePlannedLeave, cancelPlannedLeave, cancelLeave, updateLocation, getAttendance, getNotificationChannel, updateNotificationChannel,
};

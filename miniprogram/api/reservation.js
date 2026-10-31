const { get, post } = require('../utils/request');
const { withIdempotency } = require('./core-v2');

/** 我的当日预约列表。 */
function listMine() {
  return get('/api/v2/reservations');
}

/**
 * 创建三日窗口内的预约。
 * 兼容旧调用 create(vendorId, reminderConsentStatus)，新调用传 options。
 */
function create(vendorUserId, optionsOrConsent = {}) {
  const options = typeof optionsOrConsent === 'string'
    ? { reminderConsentStatus: optionsOrConsent }
    : (optionsOrConsent || {});
  return withIdempotency(post, '/api/v2/reservations', {
    vendorId: vendorUserId,
    businessDate: options.businessDate,
    preparationPreference: options.preparationPreference ?? options.preparationNote,
    reminderResults: options.reminderResults,
    reminderConsentStatus: options.reminderConsentStatus,
  }, 'reserve');
}

/** 取消预约。 */
function cancel(reservationId) {
  return withIdempotency(post, `/api/v2/reservations/${reservationId}/cancel`, {}, 'cancel-reserve');
}

/** 预约详情与核销码。 */
function detail(reservationId) {
  return get(`/api/v2/reservations/${reservationId}`);
}

/** 取消或恢复前读取最新资格与影响。 */
function changePreview(reservationId, action) {
  return get(`/api/v2/reservations/${reservationId}/change-preview?action=${encodeURIComponent(action)}`);
}

/** 恢复本人取消且仍符合资格的预约。 */
function restore(reservationId) {
  return withIdempotency(post, `/api/v2/reservations/${reservationId}/restore`, {}, 'restore-reserve');
}

module.exports = { listMine, create, cancel, detail, changePreview, restore };

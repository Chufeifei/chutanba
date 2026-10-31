const { get, post } = require('../utils/request');
const { withIdempotency } = require('./core-v2');

/** 摊主当日待核销预约列表（默认 businessDate=今天）。 */
async function listToday() {
  const workbench = await get('/api/v2/vendor/workbench');
  return get(`/api/v2/vendor/${workbench.data.vendorId}/reservations`);
}

/** 摊主近三日预约视图：按 businessDate 过滤（今/明/后）。 */
function vendorReservations(vendorId, businessDate) {
  const query = businessDate ? `?businessDate=${encodeURIComponent(businessDate)}` : '';
  return get(`/api/v2/vendor/${vendorId}/reservations${query}`);
}

/** 六位福利码手工核销（幂等由后端保证）。 */
function checkin(benefitCode) {
  return withIdempotency(post, '/api/v2/vendor/checkins', { benefitCode, method: 'MANUAL' }, 'benefit-redeem');
}

/** 扫码核销：二维码内容即 qrToken。 */
function checkinQr(qrToken) {
  return withIdempotency(post, '/api/v2/vendor/checkins', { qrToken, method: 'QR' }, 'benefit-redeem-camera');
}

/** 摊主当日核销奖励进度。 */
async function getRewardProgress() {
  const workbench = await get('/api/v2/vendor/workbench');
  return get(`/api/v2/vendors/${workbench.data.vendorId}/tags`);
}

module.exports = { listToday, vendorReservations, checkin, checkinQr, getRewardProgress };

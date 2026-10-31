const { post } = require('../utils/request');
const { get } = require('../utils/request');
const { withIdempotency } = require('./core-v2');

/** 提交账号注销申请。 */
async function request() {
  const workbench = await get('/api/v2/vendor/workbench');
  return withIdempotency(post, '/api/v2/vendor/deactivation-requests', {
    vendorId: workbench.data.vendorId,
    confirmation: '我已了解永久注销影响',
  }, 'deactivate');
}

/** 撤销待处理的注销申请。 */
async function cancel() {
  const workbench = await get('/api/v2/vendor/workbench');
  return post(`/api/v2/vendor/${workbench.data.vendorId}/deactivation-requests/withdraw`);
}

module.exports = { request, cancel };

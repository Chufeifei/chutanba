const { get, post } = require('../utils/request');

/** 摊主查看自身信用（精确分 + 事件 + 段位）。 */
function getMyCredit() {
  return get('/api/v2/vendor/credit-record');
}

/** 摊主对信用事件提交申诉。 */
async function submitAppeal({ eventId, reason }) {
  const workbench = await get('/api/v2/vendor/workbench');
  return post(`/api/v2/vendor/credit-entries/${eventId}/appeals`, { vendorId: workbench.data.vendorId, statement: reason });
}

/** 顾客查看摊主公开经营标签（段位/精确分不外露）。 */
function getPublicTags(vendorUserId) {
  return get(`/api/v2/vendors/${vendorUserId}/tags`);
}

module.exports = { getMyCredit, submitAppeal, getPublicTags };

const { get, put, remove } = require('../utils/request');

/** 我的关注列表。 */
function listFollows() {
  return get('/api/v2/follows');
}

/** 关注摊主。 */
function follow(vendorUserId) {
  return put(`/api/v2/follows/${vendorUserId}`);
}

/** 取消关注。 */
function unfollow(vendorUserId) {
  return remove(`/api/v2/follows/${vendorUserId}`);
}

module.exports = { listFollows, follow, unfollow };

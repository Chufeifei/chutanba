const { get } = require('../utils/request');

/** 摊主获取推广二维码。 */
function getQrcode() {
  return get('/api/v2/vendor/promotion');
}

module.exports = { getQrcode };

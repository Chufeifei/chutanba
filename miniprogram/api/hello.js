const { get } = require('../utils/request');

/**
 * 页面只调用语义化 API 方法，不直接接触环境 ID、云托管服务名或 callContainer。
 */
function getHello() {
  return get('/api/hello');
}

module.exports = {
  getHello,
};

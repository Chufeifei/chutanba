const { get } = require('../utils/request');

/** 顾客端可用的启用区域列表（只含标识与名称，不含中心点与半径）。 */
function listRegions() {
  return get('/api/v2/regions');
}

module.exports = { listRegions };

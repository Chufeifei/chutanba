const express = require('express');

const { createVendorsRouter } = require('./v2/vendors');
const { createRegionsRouter } = require('./v2/regions');
const { createAdminRegionsRouter } = require('./v2/admin-regions');
const { listVendors } = require('../domain/location/location-service');
const {
  createRegion,
  listAllRegions,
  listEnabledRegions,
  setRegionStatus,
  updateRegion,
} = require('../domain/region/region-service');

// 架构骨架：仅保留路由装配机制。
// 业务路由按需求文档逐模块挂载到此聚合器。
const router = express.Router();

// 顾客端：发现列表与位置筛选、区域字典。
createVendorsRouter({ router, listVendors });
createRegionsRouter({ router, listEnabledRegions });

// 管理端：区域字典维护（运营在 superadmin 管理端操作）。
// 鉴权由 admin-regions 内部挂载（可信身份 + 运营白名单，未配置则503），
// 不在装配处覆盖，以便默认鉴权链路始终生效。
createAdminRegionsRouter({
  router,
  createRegion,
  updateRegion,
  setRegionStatus,
  listAllRegions,
});

module.exports = router;

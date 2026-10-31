/**
 * 顾客端区域字典路由：GET /api/v2/regions
 *
 * 区域是平台自定义的经营片区（中心点 + 覆盖半径），不是行政区划。
 * 顾客端只读取区域标识与名称，不返回中心点与半径等几何信息。
 */

function createRegionsRouter({ router, listEnabledRegions }) {
  router.get('/api/v2/regions', async (req, res, next) => {
    try {
      const items = await listEnabledRegions();
      return res.status(200).json({ code: 200, msg: 'ok', data: { items } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createRegionsRouter };

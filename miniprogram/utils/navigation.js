/**
 * 外部导航唯一出口。
 *
 * 需求 C-02.5 / AC-18 要求：每次从小程序新发起导航前都必须在线复核；
 * 无法确认最新状态时不得用缓存坐标继续发起。
 *
 * 因此全项目只有 services/navigation 允许调用本文件，
 * 且传入的坐标只能来自 navigation-launches 的响应 —— 不能来自列表、详情或本地缓存。
 * 本文件不提供"直接用详情坐标导航"的便捷方法，避免这条边界被绕过。
 */
const { ApiError, ERROR_CATEGORY } = require('./failure');

/**
 * @param {object} launch navigation-launches 成功响应的 data
 * @param {object} launch.currentLocation { lat, lng, locationName }
 * @param {object} [options]
 * @param {function} [options.fail] 导航失败回调，默认弹提示
 */
function openFromLaunch(launch, options = {}) {
  const location = launch && launch.currentLocation;
  const lat = location ? Number(location.lat) : NaN;
  const lng = location ? Number(location.lng) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ApiError({
      message: '无法确认最新位置，已取消本次导航',
      category: ERROR_CATEGORY.BUSINESS_RULE,
    });
  }

  const name = location.locationName || '摊主位置';
  return new Promise((resolve, reject) => {
    wx.openLocation({
      latitude: lat,
      longitude: lng,
      name,
      address: name,
      scale: 18,
      success: () => resolve({ opened: true }),
      fail: (error) => {
        // 用户取消或微信导航不可用，都属于"本次没有发起"，不视为平台错误
        if (options.fail) {
          options.fail(error);
        } else {
          wx.showToast({ title: '未能打开导航', icon: 'none' });
        }
        reject(new ApiError({
          message: '未能打开导航',
          category: ERROR_CATEGORY.BUSINESS_RULE,
          data: error,
        }));
      },
    });
  });
}

module.exports = { openFromLaunch };

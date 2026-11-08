/**
 * 定位能力封装。
 *
 * 只做一件事：把 wx.getLocation 的回调式 API 转成带分类的 Promise。
 * 是否允许拍照、是否超距、窗口是否关闭，全部由服务端判定，这里不预判。
 *
 * 坐标系固定 GCJ-02（config/contracts.js 的 COORDINATE_SYSTEM），
 * 不得混入 WGS-84 或 BD-09，否则同一位置在不同环节的偏移不一致。
 */
const { ApiError, ERROR_CATEGORY } = require('./failure');

const LOCATION_FAILURE = Object.freeze({
  DENIED: 'LOCATION_DENIED',
  SYSTEM_DENIED: 'LOCATION_SYSTEM_DENIED',
  UNAVAILABLE: 'LOCATION_UNAVAILABLE',
});

const FAILURE_MESSAGE = Object.freeze({
  [LOCATION_FAILURE.DENIED]: '未获得位置授权，无法完成本次定位',
  [LOCATION_FAILURE.SYSTEM_DENIED]: '系统未开启定位权限，请在系统设置中允许微信使用位置',
  [LOCATION_FAILURE.UNAVAILABLE]: '暂时无法取得位置，请移动到开阔处后重试',
});

function classifyLocationError(errMsg) {
  const message = String(errMsg || '');
  if (/auth\s*deny|authorize|permission denied/i.test(message)) return LOCATION_FAILURE.DENIED;
  if (/system permission/i.test(message)) return LOCATION_FAILURE.SYSTEM_DENIED;
  return LOCATION_FAILURE.UNAVAILABLE;
}

/**
 * 取得本次定位。
 * @returns {Promise<{lat:number,lng:number,locatedAtMs:number,accuracy:number}>}
 * @throws {ApiError} category === BUSINESS_RULE，message 可直接展示
 */
function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      success: (result) => {
        const lat = Number(result.latitude);
        const lng = Number(result.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          reject(new ApiError({
            message: FAILURE_MESSAGE[LOCATION_FAILURE.UNAVAILABLE],
            category: ERROR_CATEGORY.BUSINESS_RULE,
            data: { locationFailure: 'LOCATION_INVALID' },
          }));
          return;
        }
        resolve({
          lat,
          lng,
          // 用服务端可校验的客户端时刻辅助展示；真正的有效期由 locationContextToken 控制
          locatedAtMs: Date.now(),
          accuracy: Number(result.accuracy) || 0,
        });
      },
      fail: (error) => {
        const failure = classifyLocationError(error && error.errMsg);
        reject(new ApiError({
          message: FAILURE_MESSAGE[failure],
          category: ERROR_CATEGORY.BUSINESS_RULE,
          data: { locationFailure: failure },
        }));
      },
    });
  });
}

/** 把定位结果转成契约要求的 LocationInput（字段名与后端一致）。 */
function toLocationInput(location) {
  return {
    lat: location.lat,
    lng: location.lng,
    locationName: location.locationName || '',
    locatedAtMs: location.locatedAtMs,
  };
}

module.exports = {
  LOCATION_FAILURE,
  getCurrentLocation,
  toLocationInput,
  classifyLocationError,
};

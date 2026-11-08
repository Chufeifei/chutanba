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
const timing = require('../config/timing');

const LOCATION_FAILURE = Object.freeze({
  DENIED: 'LOCATION_DENIED',
  SYSTEM_DENIED: 'LOCATION_SYSTEM_DENIED',
  UNAVAILABLE: 'LOCATION_UNAVAILABLE',
  INVALID: 'LOCATION_INVALID',
});

const FAILURE_MESSAGE = Object.freeze({
  [LOCATION_FAILURE.DENIED]: '未获得位置授权，无法完成本次定位',
  [LOCATION_FAILURE.SYSTEM_DENIED]: '系统未开启定位权限，请在系统设置中允许微信使用位置',
  [LOCATION_FAILURE.UNAVAILABLE]: '暂时无法取得位置，请移动到开阔处后重试',
  [LOCATION_FAILURE.INVALID]: '暂时无法取得位置，请移动到开阔处后重试',
});

function classifyLocationError(errMsg) {
  const message = String(errMsg || '');
  // 系统定位开关关闭要先判：其 errMsg 同时含 "permission denied"，
  // 放在通用授权拒绝规则之后会被抢先命中，拿不到 SYSTEM_DENIED 标识
  if (/system permission/i.test(message)) return LOCATION_FAILURE.SYSTEM_DENIED;
  if (/auth\s*deny|authorize|permission denied/i.test(message)) return LOCATION_FAILURE.DENIED;
  // 超时与其余失败都归到同一个可被统一分类的标识，保证每条路径都有明确结果
  if (/timeout|time\s*out/i.test(message)) return LOCATION_FAILURE.UNAVAILABLE;
  return LOCATION_FAILURE.UNAVAILABLE;
}

/**
 * 取得本次定位。
 * @returns {Promise<{lat:number,lng:number,locatedAtMs:number,accuracy:number}>}
 * @throws {ApiError} category === BUSINESS_RULE，message 可直接展示
 */
function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle(value);
    };
    // 回调长时间不落地时兜底：仍以同一可分类标识返回，避免等待永不结束
    timer = setTimeout(() => {
      finish(reject, new ApiError({
        message: FAILURE_MESSAGE[LOCATION_FAILURE.UNAVAILABLE],
        category: ERROR_CATEGORY.BUSINESS_RULE,
        data: { locationFailure: LOCATION_FAILURE.UNAVAILABLE },
      }));
    }, timing.REQUEST_TIMEOUT_MS);
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      success: (result) => {
        const lat = Number(result.latitude);
        const lng = Number(result.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          finish(reject, new ApiError({
            message: FAILURE_MESSAGE[LOCATION_FAILURE.INVALID],
            category: ERROR_CATEGORY.BUSINESS_RULE,
            data: { locationFailure: LOCATION_FAILURE.INVALID },
          }));
          return;
        }
        finish(resolve, {
          lat,
          lng,
          // 用服务端可校验的客户端时刻辅助展示；真正的有效期由 locationContextToken 控制
          locatedAtMs: Date.now(),
          accuracy: Number(result.accuracy) || 0,
        });
      },
      fail: (error) => {
        const failure = classifyLocationError(error && error.errMsg);
        finish(reject, new ApiError({
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

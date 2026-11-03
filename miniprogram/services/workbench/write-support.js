/**
 * 摊主写命令的共用底座（P09）。
 *
 * 把「取定位」「签发定位上下文」「收尾开摊尝试」这几件在开摊与刷新位置之间
 * 重复的动作收在一处：两条流程的顺序约束完全一样，分开写迟早会抄错。
 */
const meApi = require('../../api/me');
const sessionApi = require('../../api/vendor-session');
const { runWrite, abandonPending } = require('../submission');
const { WRITE_OUTCOME } = require('../../utils/failure');
const location = require('../../utils/location');
const actionKey = require('../../utils/action-key');

// 与后端 modules/session/service/*.js 的 operationType 对齐。
// 定位上下文按用途分开：不同用途的目标不同，共用一个键会在换目标时撞同键不同体。
const OPERATION = Object.freeze({
  ATTEMPT: 'OPEN_ATTEMPT',
  ATTEMPT_FINISH: 'OPEN_ATTEMPT_FINISH',
  CONTEXT_OPEN: 'LOCATION_CONTEXT_OPEN',
  CONTEXT_REFRESH: 'LOCATION_CONTEXT_REFRESH',
  OPEN: 'SESSION_OPEN',
  REFRESH: 'SESSION_REFRESH',
  CLOSE: 'SESSION_CLOSE',
});

const DEFAULT_LOCATION_NAME = '我的摊位位置';
const MAX_LOCATION_NAME_LENGTH = 80;

/** 位置名称是服务端白名单里的必填字段（1～80 字符），空值必须在这里补上。 */
function resolveLocationName(name) {
  const value = typeof name === 'string' ? name.trim() : '';
  if (!value) return DEFAULT_LOCATION_NAME;
  return Array.from(value).slice(0, MAX_LOCATION_NAME_LENGTH).join('');
}

/** 取本次定位并转成服务端要求的四字段结构（lat/lng/locationName/locatedAtMs）。 */
async function takeLocation(locationName) {
  const current = await location.getCurrentLocation();
  return location.toLocationInput({
    lat: current.lat,
    lng: current.lng,
    locatedAtMs: current.locatedAtMs,
    locationName: resolveLocationName(locationName),
  });
}

/** 同一操作类型已有未确认的键时不能再发新请求，否则服务端会判同键不同体。 */
function pendingOutcome(operationType, message) {
  if (!actionKey.peekKey(operationType)) return null;
  return { outcome: WRITE_OUTCOME.UNKNOWN, message, needQuery: true, operationType };
}

/**
 * 签发一次性定位上下文。
 * 必须在取定位**之前**调用：服务端要求定位时刻不早于上下文签发时刻。
 */
async function issueContext(operationType, purpose, targetId) {
  const result = await runWrite({
    operationType,
    execute: ({ idempotencyKey }) => meApi.createLocationContext(
      { purpose, targetId: String(targetId) },
      { idempotencyKey },
    ),
  });
  if (result.outcome !== WRITE_OUTCOME.SUCCEEDED) {
    // 上下文只在本轮内使用，失败后原键必须丢弃：留着会让下一次换 targetId 的签发撞同键不同体
    abandonPending({ operationType });
  }
  return result;
}

/** 尝试收尾只影响试点统计，不影响营业事实，失败不阻断用户流程。 */
async function finishAttempt(attemptId, outcome) {
  try {
    await runWrite({
      operationType: OPERATION.ATTEMPT_FINISH,
      execute: ({ idempotencyKey }) => sessionApi.finishOpenAttempt(
        String(attemptId),
        { outcome },
        { idempotencyKey },
      ),
    });
  } catch (error) {
    // 忽略：统计口径的偏差好过让摊主卡在开摊流程里
  }
}

function locationFailureOf(error) {
  return error && error.data ? error.data.locationFailure : '';
}

/** 定位失败时的收尾结果码：拒绝授权算取消，取不到位置算定位失败。 */
function attemptOutcomeOf(locationFailure) {
  return locationFailure === location.LOCATION_FAILURE.UNAVAILABLE ? 'LOCATION_FAILED' : 'CANCELLED';
}

module.exports = {
  OPERATION,
  DEFAULT_LOCATION_NAME,
  resolveLocationName,
  takeLocation,
  pendingOutcome,
  issueContext,
  finishAttempt,
  locationFailureOf,
  attemptOutcomeOf,
};

/**
 * 现场反馈提交（P05 的唯一写入口）。
 *
 * 顺序是硬约束，不能调换：
 *   1. 取本次实时定位 —— 服务端要核对"距原营业位置 ≤300 米"；
 *   2. 用这个定位申请 FEEDBACK 用途的一次性上下文（5 分钟有效）；
 *   3. 带着上下文令牌提交，服务端据此判断"这段定位确实是刚取的"。
 * 先申请上下文再定位，会被判 CONTEXT_EXPIRED；把定位塞进 URL 或缓存，会被判 LOCATION_INVALID。
 *
 * 三步都是写命令，各自独立幂等键：上下文签发失败与提交结果未知要分开查。
 */
const meApi = require('../../api/me');
const feedbackApi = require('../../api/feedback');
const { runWrite, queryOutcome } = require('../submission');
const location = require('../../utils/location');
const { ApiError, ERROR_CATEGORY, WRITE_OUTCOME } = require('../../utils/failure');

// 与后端 session/service/contexts.js、feedback/service.js 的操作类型一致
const CONTEXT_OPERATION = 'LOCATION_CONTEXT_ISSUE';
const SUBMIT_OPERATION = 'FIELD_FEEDBACK_SUBMIT';

/**
 * 提交现场反馈。
 * @param {object} params
 * @param {string} params.observationId 详情页或候选列表建立的观察
 * @param {number} params.observationVersion 候选列表给的版本，用于防并发覆盖
 * @param {string} params.type 三类问题之一
 * @param {string} [params.description] 补充说明，可不填
 * @returns {Promise<{outcome: string, stage: string, data?: object, message?: string,
 *   idempotencyKey?: string, locationFailure?: string}>}
 * @throws {ApiError} 定位失败时抛出，message 可直接展示
 */
async function submitFeedback({
  observationId, observationVersion, type, description,
}) {
  let current;
  try {
    current = await location.getCurrentLocation();
  } catch (error) {
    // 定位失败发生在任何写请求之前，可以直接让用户重试，不产生"结果未知"
    throw new ApiError({
      message: (error && error.message) || '暂时无法取得位置，请移动到开阔处后重试',
      category: ERROR_CATEGORY.BUSINESS_RULE,
      data: error && error.data,
    });
  }

  const context = await runWrite({
    operationType: CONTEXT_OPERATION,
    execute: ({ idempotencyKey }) => meApi.createLocationContext(
      { purpose: 'FEEDBACK', targetId: String(observationId) },
      { idempotencyKey },
    ),
  });
  if (context.outcome !== WRITE_OUTCOME.SUCCEEDED) {
    // 上下文阶段还没发出反馈：这里不可能产生反馈记录，因此"未知"对业务而言是确定的"未提交"。
    // 按结果未知展示会把用户引向"查提交结果"，而那个键属于提交操作，查不到只会更迷惑。
    // 上下文操作的键仍由 submission 保留，重试时服务端会按同键回放，不会重复签发。
    if (context.outcome === WRITE_OUTCOME.UNKNOWN) {
      return {
        outcome: WRITE_OUTCOME.FAILED,
        stage: 'context',
        retryable: true,
        message: '未能确认定位凭据，本次反馈尚未提交，可以重试',
      };
    }
    return { ...context, stage: 'context' };
  }

  const token = context.data && context.data.locationContextToken;
  if (!token) {
    // 拿到成功响应却没有令牌，说明契约不一致；按可重试处理，不猜一个令牌出来
    throw new ApiError({
      message: '未能取得定位凭据，请重试',
      category: ERROR_CATEGORY.RETRYABLE,
      retryable: true,
    });
  }

  const submitted = await runWrite({
    operationType: SUBMIT_OPERATION,
    execute: ({ idempotencyKey }) => feedbackApi.submitFieldFeedback({
      observationId: String(observationId),
      type,
      description: description ? String(description).trim() : undefined,
      locationContextToken: token,
      // 反馈定位只收 lat/lng/locatedAtMs 三个字段：后端按白名单精确匹配，
      // 多带 locationName 会被判 UNKNOWN_FIELD 直接 400（因此不复用 toLocationInput）
      location: { lat: current.lat, lng: current.lng, locatedAtMs: current.locatedAtMs },
      expectedObservationVersion: observationVersion,
    }, { idempotencyKey }),
  });
  return { ...submitted, stage: 'submit' };
}

/** 提交超时后按原键查结果：查到了成立就直接进结果页，不重新提交。 */
async function querySubmitOutcome() {
  return queryOutcome({ operationType: SUBMIT_OPERATION });
}

module.exports = {
  CONTEXT_OPERATION,
  SUBMIT_OPERATION,
  submitFeedback,
  querySubmitOutcome,
};

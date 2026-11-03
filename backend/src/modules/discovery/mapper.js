/**
 * 公开投影白名单（契约 §4）：正向逐字段赋值，禁止展开数据库行。
 * ID 一律字符串、时间一律毫秒整数、坐标转 Number；
 * 休息与不可查看分支必须「字段缺省」而不是给 null，避免客户端把 null 当作可用坐标。
 */
function toCurrentLocation(row) {
  return {
    lat: Number(row.lat),
    lng: Number(row.lng),
    locationName: row.location_name,
    locatedAtMs: Number(row.located_at_ms),
  };
}

function toPublicListItem(row, { phase, distanceM }) {
  const item = {
    vendorId: String(row.vendor_id),
    name: row.vendor_name,
    categoryCode: row.category_code,
    regularItemsSummary: row.regular_items_text,
    phase,
    plannedEndAtMs: Number(row.planned_end_at_ms),
    lastLocatedAtMs: Number(row.located_at_ms),
    currentLocation: toCurrentLocation(row),
  };
  // 距离只在请求带顾客定位时出现；不带定位的响应不得出现虚构距离。
  if (typeof distanceM === 'number') item.distanceM = distanceM;
  return item;
}

function toPublicDetail(row, { availability, phaseInfo, vendorId, serverNowMs }) {
  if (availability === 'OPEN') {
    return {
      vendorId: String(row.vendor_id),
      availability: 'OPEN',
      serverNowMs,
      profile: {
        name: row.vendor_name,
        categoryCode: row.category_code,
        regularItemsSummary: row.regular_items_text,
        priceDescription: row.price_description,
        announcement: row.announcement,
      },
      sessionSummary: {
        sessionId: String(row.session_id),
        locationVersionId: String(row.location_id),
        phase: phaseInfo.phase,
        startedAtMs: Number(row.started_at_ms),
        plannedEndAtMs: Number(row.planned_end_at_ms),
        remainingMs: phaseInfo.remainingMs,
      },
      currentLocation: toCurrentLocation(row),
    };
  }
  if (availability === 'RESTING') {
    return {
      vendorId: String(row.vendor_id),
      availability: 'RESTING',
      serverNowMs,
      profile: {
        name: row.vendor_name,
        categoryCode: row.category_code,
        regularItemsSummary: row.regular_items_text,
        priceDescription: row.price_description,
        announcement: row.announcement,
      },
    };
  }
  return {
    vendorId: String(vendorId || (row && row.vendor_id) || ''),
    availability: 'UNVIEWABLE',
    serverNowMs,
    notice: '该摊位当前暂不可查看',
  };
}

function toObservationView({
  observationId, eventAtMs, eventPublicStatus, vendorId, vendorName, categoryCode,
  sessionId, locationVersionId, phase, claimToken,
}) {
  const view = {
    observationId: String(observationId),
    eventAtMs,
    eventPublicStatus,
    vendorSummary: { vendorId: String(vendorId), name: vendorName, categoryCode },
    sessionSummary: {
      sessionId: String(sessionId),
      locationVersionId: String(locationVersionId),
      phase,
    },
  };
  // 只有未识别身份才签发领取令牌；已识别身份不返回令牌。
  if (claimToken) view.claimToken = claimToken;
  return view;
}

function toNavigationCheckView({
  navigationCheckId, decision, observationId, expiresAtMs,
  plannedEndAtMs, remainingMs, sessionId, locationVersionId, claimToken,
}) {
  const view = {
    navigationCheckId: String(navigationCheckId),
    decision,
    observationId: String(observationId),
    expiresAtMs,
  };
  if (decision === 'CONFIRM_REQUIRED') {
    view.plannedEndAtMs = plannedEndAtMs;
    view.remainingMs = remainingMs;
  }
  if (decision === 'READY') {
    view.sessionId = String(sessionId);
    view.locationVersionId = String(locationVersionId);
    // 未识别身份才签发领取令牌，供 W6 绑定反馈；已识别身份不返回令牌。
    if (claimToken) view.claimToken = claimToken;
  }
  return view;
}

function toLaunchView({ launchId, recordedAtMs, sessionId, locationVersionId, row }) {
  const view = {
    launchId,
    recordedAtMs,
    sessionId: String(sessionId),
    locationVersionId: String(locationVersionId),
  };
  // 位置已被替换或轮次已结束时，回放不得再给出坐标。
  if (row) view.currentLocation = toCurrentLocation(row);
  return view;
}

function toCategoryList(categories, version) {
  return { version, categories };
}

module.exports = {
  toPublicListItem,
  toPublicDetail,
  toObservationView,
  toNavigationCheckView,
  toLaunchView,
  toCategoryList,
};

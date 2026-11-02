/** 数据库行 → 本人／管理读模型；只输出契约字段，不把行对象直接返回。 */

function toBigInt(value) {
  return value === null || value === undefined ? null : Number(value);
}

function toId(value) {
  return value === null || value === undefined ? null : String(value);
}

function kindOf(activeProfileVersionId, versionId) {
  const active = toBigInt(activeProfileVersionId);
  // 生效指针只在批准时切换，因此“申请时是否已有生效版本”可由当前指针与申请 ID 反推。
  return active !== null && active !== toBigInt(versionId) ? 'UPDATE' : 'FIRST';
}

function toActiveProfile(row) {
  if (!row) return null;
  return {
    versionId: String(row.id),
    versionNo: Number(row.version_no),
    vendorName: row.vendor_name,
    categoryCode: row.category_code,
    regularItemsText: row.regular_items_text,
    priceDescription: row.price_description,
    announcement: row.announcement,
    approvedAtMs: toBigInt(row.decided_at_ms),
    decidedAtMs: toBigInt(row.decided_at_ms),
  };
}

function toPendingSubmission(row) {
  if (!row) return null;
  return {
    submissionId: String(row.id),
    versionNo: Number(row.version_no),
    reviewStatus: row.review_status,
    submittedAtMs: toBigInt(row.submitted_at_ms),
    vendorName: row.vendor_name,
    categoryCode: row.category_code,
    regularItemsText: row.regular_items_text,
    priceDescription: row.price_description,
    announcement: row.announcement,
  };
}

function toLatestDecision(row, activeProfileVersionId) {
  if (!row) return null;
  return {
    submissionId: String(row.id),
    reviewStatus: row.review_status,
    reason: row.decision_reason === null || row.decision_reason === undefined ? undefined : row.decision_reason,
    decidedAtMs: toBigInt(row.decided_at_ms),
    kind: kindOf(activeProfileVersionId, row.id),
  };
}

/** 设计 §4.1 的七值派生；无生效指针时不会返回 ACTIVE。 */
function deriveProfileState({ pendingVersion, latestDecided, activeProfileVersionId }) {
  if (!activeProfileVersionId) {
    if (pendingVersion) return 'FIRST_PENDING';
    if (!latestDecided) return 'NONE';
    if (latestDecided.review_status === 'REJECTED') return 'FIRST_REJECTED';
    if (latestDecided.review_status === 'INVALIDATED') return 'INVALIDATED';
    return 'NONE';
  }
  if (pendingVersion) return 'UPDATE_PENDING';
  if (latestDecided && latestDecided.review_status === 'REJECTED' &&
      toBigInt(latestDecided.id) !== toBigInt(activeProfileVersionId)) {
    return 'UPDATE_REJECTED';
  }
  return 'ACTIVE';
}

function toSelfProfile({ vendor, activeVersion, pendingVersion, latestDecided }) {
  if (!vendor) return { profileState: 'NONE' };
  const profileState = deriveProfileState({
    pendingVersion, latestDecided, activeProfileVersionId: vendor.active_profile_version_id,
  });
  const result = { profileState, stateVersion: Number(vendor.state_version) };
  if (activeVersion) result.activeProfile = toActiveProfile(activeVersion);
  if (pendingVersion) result.pendingSubmission = toPendingSubmission(pendingVersion);
  if (latestDecided) {
    result.latestDecision = toLatestDecision(latestDecided, vendor.active_profile_version_id);
  }
  return result;
}

function toSelfContext({ vendor, pendingVersion, latestDecided }) {
  if (!vendor) return { profileState: 'NONE' };
  const result = {
    profileState: deriveProfileState({
      pendingVersion, latestDecided, activeProfileVersionId: vendor.active_profile_version_id,
    }),
    stateVersion: Number(vendor.state_version),
  };
  if (vendor.active_profile_version_id) {
    result.activeProfileVersionId = String(vendor.active_profile_version_id);
  }
  return result;
}

function toOwnSubmission(version, event, activeProfileVersionId) {
  if (!version) return null;
  const result = {
    submissionId: String(version.id),
    versionNo: Number(version.version_no),
    reviewStatus: version.review_status,
    activeProfileVersionId: toId(activeProfileVersionId) || undefined,
  };
  if (event && event.reason !== null && event.reason !== undefined) result.decisionReason = event.reason;
  const decidedAtMs = toBigInt(version.decided_at_ms);
  if (decidedAtMs !== null) result.decidedAtMs = decidedAtMs;
  return result;
}

function toReviewSummary(row) {
  return {
    submissionId: String(row.id),
    vendorId: String(row.vendor_id),
    candidateName: row.vendor_name,
    versionNo: Number(row.version_no),
    kind: kindOf(row.active_profile_version_id, row.id),
    submittedAtMs: toBigInt(row.submitted_at_ms),
    taskVersion: Number(row.task_version),
    currentActiveName: row.active_name || undefined,
  };
}

function toReviewHistory(rows) {
  return rows.map((row) => ({
    decision: row.decision,
    reason: row.reason === null ? undefined : row.reason,
    actorAccountId: toId(row.actor_account_id) || undefined,
    decidedAtMs: toBigInt(row.decided_at_ms),
  }));
}

function toReviewDetail({ version, activeVersion, history, activeProfileVersionId }) {
  return {
    submissionId: String(version.id),
    vendorId: String(version.vendor_id),
    reviewStatus: version.review_status,
    vendorName: version.vendor_name,
    categoryCode: version.category_code,
    regularItemsText: version.regular_items_text,
    priceDescription: version.price_description,
    announcement: version.announcement,
    versionNo: Number(version.version_no),
    taskVersion: Number(version.task_version),
    submittedAtMs: toBigInt(version.submitted_at_ms),
    kind: kindOf(activeProfileVersionId, version.id),
    currentActive: toActiveProfile(activeVersion),
    reviewHistory: toReviewHistory(history),
  };
}

module.exports = {
  deriveProfileState, toSelfProfile, toSelfContext, toOwnSubmission,
  toReviewSummary, toReviewDetail, toActiveProfile,
};

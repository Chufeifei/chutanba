/**
 * 清除预览（契约 §5.3）。
 *
 * 预览只回答三件事：会被清掉什么、当前营业会怎样、哪些记录按规则仍要保留。
 * 预览不是执行：这里不写任何业务数据。
 */
const { withTransaction } = require('../../../db/transaction');
const { nowMs } = require('../../../db/clock');
const account = require('../../account');
const feedback = require('../../feedback');
const impact = require('../../impact');
const profile = require('../../profile');
const retention = require('../../retention');
const session = require('../../session');
const mapper = require('../mapper');
const schema = require('../schema');
const { readRetentionExceptions } = require('./exceptions');

/** 当前轮次：清除请求成立时会被结束，页面据此提示摊主。 */
async function readActiveSessionImpact(connection, { vendor }) {
  const empty = { hasActiveSession: false, willEnd: false, endReason: null };
  if (!vendor || !vendor.current_session_id) return empty;
  const current = await session.findSessionInTransaction(connection, {
    sessionId: Number(vendor.current_session_id),
  });
  if (!current || current.ended_at_ms !== null) return empty;
  return {
    hasActiveSession: true,
    sessionId: String(current.id),
    startedAtMs: Number(current.started_at_ms),
    plannedEndAtMs: Number(current.planned_end_at_ms),
    willEnd: true,
    endReason: 'SELF_STOP',
  };
}

/** 待审与未结事项：清除会冻结待审资料，未结事项按规则继续保留。 */
async function readPendingReviewImpact(connection, { vendorId }) {
  if (vendorId === null) {
    return {
      pendingProfileVersions: 0,
      invalidatedOnAccept: 0,
      openFeedbackCases: 0,
      openImpactReviews: 0,
    };
  }
  const pendingProfileVersions = await profile.countPendingVersionsInTransaction(connection, { vendorId });
  const cases = await feedback.listCaseRetentionInTransaction(connection, { vendorId });
  const openFeedbackCases = cases.filter((row) => row.status === 'PENDING').length;
  const openImpactReviews = await impact.countOpenReviewsByVendorInTransaction(connection, { vendorId });
  return {
    pendingProfileVersions,
    invalidatedOnAccept: pendingProfileVersions,
    openFeedbackCases,
    openImpactReviews,
  };
}

async function previewClear(identity, query) {
  const actor = await account.resolveAccount(identity);
  const scope = schema.parseScopeQuery(query);
  return withTransaction(async (connection) => {
    const now = await nowMs(connection);
    const vendor = await session.findVendorByAccountInTransaction(connection, { accountId: actor.id });
    const vendorId = vendor ? Number(vendor.id) : null;
    // 账号仍有摊主资料时只清账号资料会留下无主摊主：预览必须说明，并要求本人改选 ALL。
    const requiresExplicitAll = scope === 'ACCOUNT_DATA' && vendorId !== null;
    const effectiveScope = requiresExplicitAll ? 'ALL' : scope;
    return mapper.toPreview({
      scope,
      effectiveScope,
      requiresExplicitAll,
      affectedKinds: mapper.kindsOf(effectiveScope),
      activeSessionImpact: await readActiveSessionImpact(connection, { vendor }),
      pendingReviewImpact: await readPendingReviewImpact(connection, { vendorId }),
      retentionExceptions: await readRetentionExceptions(connection, { vendorId, now }),
      estimatedCompletion: {
        dueAtMs: retention.clearRequestDueAtMs(now),
        days: retention.RETENTION_DAYS.CLEAR_REQUEST,
      },
    });
  });
}

module.exports = { previewClear };

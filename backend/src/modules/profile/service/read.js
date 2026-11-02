const { withTransaction } = require('../../../db/transaction');
const { DomainError } = require('../../../domain/errors');
const account = require('../../account');
const authorization = require('../../authorization');
const repository = require('../repository');
const mapper = require('../mapper');
const schema = require('../schema');
const { assertReviewer } = require('./guards');

async function readVendorState(connection, vendor) {
  const pendingVersion = await repository.findPendingVersion(connection, Number(vendor.id));
  const latestDecided = await repository.findLatestDecidedVersion(connection, Number(vendor.id));
  return { pendingVersion, latestDecided };
}

async function readActiveVersion(connection, vendor) {
  return vendor.active_profile_version_id
    ? repository.findVersionById(connection, Number(vendor.active_profile_version_id))
    : null;
}

async function getSelfProfile(identity) {
  const actor = await account.resolveAccount(identity);
  return withTransaction(async (connection) => {
    const vendor = await repository.findVendorByAccount(connection, actor.id);
    if (!vendor) return mapper.toSelfProfile({ vendor: null });
    if (vendor.lifecycle_status !== 'ACTIVE') throw new DomainError('NOT_ELIGIBLE');
    const state = await readVendorState(connection, vendor);
    return mapper.toSelfProfile({ vendor, activeVersion: await readActiveVersion(connection, vendor), ...state });
  });
}

async function getOwnSubmission(identity, submissionId) {
  const versionId = schema.assertSubmissionId(submissionId);
  const actor = await account.resolveAccount(identity);
  return withTransaction(async (connection) => {
    const vendor = await repository.findVendorByAccount(connection, actor.id);
    const version = await repository.findVersionById(connection, versionId);
    // 他人申请与不存在统一 404，避免按 ID 枚举他人的资料申请。
    if (!vendor || !version || Number(version.vendor_id) !== Number(vendor.id)) {
      throw new DomainError('RESOURCE_NOT_FOUND');
    }
    const event = await repository.findReviewEvent(connection, versionId);
    return mapper.toOwnSubmission(version, event, vendor.active_profile_version_id);
  });
}

/** 供 GET /me 合并：只返回展示字段，不改变账号版本语义。 */
async function getSelfContext(vendorId) {
  if (!Number.isSafeInteger(vendorId) || vendorId <= 0) return { profileState: 'NONE' };
  return withTransaction(async (connection) => {
    const vendor = await repository.findVendorById(connection, vendorId);
    if (!vendor || vendor.lifecycle_status !== 'ACTIVE') return { profileState: 'NONE' };
    return mapper.toSelfContext({ vendor, ...(await readVendorState(connection, vendor)) });
  });
}

async function listReviews(identity, query) {
  const actor = await account.resolveAccount(identity);
  const params = schema.normalizeReviewQuery(query);
  return withTransaction(async (connection) => {
    // 管理队列每次请求都重新读取权限，撤销后下一次调用立即失效。
    assertReviewer(await authorization.getCapabilities(connection, actor.id));
    const rows = await repository.findReviewQueue(connection, {
      status: params.status, cursor: params.cursor, limit: params.limit + 1,
    });
    const pageRows = rows.slice(0, params.limit);
    const result = { rows: pageRows.map(mapper.toReviewSummary) };
    if (rows.length > params.limit) {
      const last = pageRows[pageRows.length - 1];
      result.nextCursor = schema.encodeReviewCursor({
        status: params.status,
        submittedAtMs: Number(last.submitted_at_ms),
        id: Number(last.id),
      });
    }
    return result;
  });
}

async function getReview(identity, submissionId) {
  const versionId = schema.assertSubmissionId(submissionId);
  const actor = await account.resolveAccount(identity);
  return withTransaction(async (connection) => {
    assertReviewer(await authorization.getCapabilities(connection, actor.id));
    const version = await repository.findVersionById(connection, versionId);
    if (!version) throw new DomainError('RESOURCE_NOT_FOUND');
    const vendor = await repository.findVendorById(connection, version.vendor_id);
    const activeVersion = vendor && vendor.active_profile_version_id
      ? await repository.findVersionById(connection, Number(vendor.active_profile_version_id))
      : null;
    const history = await repository.findReviewHistory(connection, versionId);
    return mapper.toReviewDetail({
      version,
      activeVersion,
      history,
      activeProfileVersionId: vendor ? vendor.active_profile_version_id : null,
    });
  });
}

module.exports = { getSelfProfile, getOwnSubmission, getSelfContext, listReviews, getReview };

/**
 * 影响复核的读模型：本人视角与管理视角。
 *
 * 本人只看到自己的申请内容、结论与本人可见理由；管理侧只给摘要，
 * 决定所需的 taskVersion 一并给出。两侧都不带内部证据与第三人身份。
 */
const { withTransaction } = require('../../../../db/transaction');
const { DomainError } = require('../../../../domain/errors');
const account = require('../../../account');
const authorization = require('../../../authorization');
const repository = require('../../repository');
const mapper = require('../../mapper');
const schema = require('../../schema');

const ADMIN_CAPABILITIES = Object.freeze(['ADMIN', 'SUPER_ADMIN']);

/** 本人复核列表：只给本人摊主的申请与结论。 */
async function listMyReviews(identity, query) {
  const actor = await account.resolveAccount(identity);
  const input = schema.parseListQuery(query);
  return withTransaction(async (connection) => {
    const vendorId = await repository.findVendorIdByAccount(connection, actor.id);
    if (vendorId === null) return { rows: [], nextCursor: null };
    const rows = await repository.listReviewsForVendor(connection, {
      vendorId, cursor: input.cursor, limit: input.limit,
    });
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page.map(mapper.toReviewItem),
      nextCursor: hasMore && last ? `${last.created_at_ms}_${last.id}` : null,
    };
  });
}

/** 本人复核详情：他人申请一律按不存在返回，不泄露申请是否存在。 */
async function getMyReview(identity, reviewId) {
  const actor = await account.resolveAccount(identity);
  return withTransaction(async (connection) => {
    const vendorId = await repository.findVendorIdByAccount(connection, actor.id);
    if (vendorId === null) throw new DomainError('RESOURCE_NOT_FOUND');
    const row = await repository.findReviewById(connection, reviewId);
    if (!row || Number(row.vendor_id) !== vendorId) throw new DomainError('RESOURCE_NOT_FOUND');
    return mapper.toReviewItem(row);
  });
}

/** 管理复核队列：只给摘要，决定所需的 taskVersion 一并给出。 */
async function listManagementReviews(identity, query) {
  const actor = await account.resolveAccount(identity);
  const input = schema.parseListQuery(query);
  return withTransaction(async (connection) => {
    authorization.assertAnyCapability(
      await authorization.getCapabilities(connection, actor.id), ADMIN_CAPABILITIES,
    );
    const rows = await repository.listReviewsForManagement(connection, {
      status: input.status, cursor: input.cursor, limit: input.limit,
    });
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page.map(mapper.toManagementReviewSummary),
      nextCursor: hasMore && last ? `${last.created_at_ms}_${last.id}` : null,
    };
  });
}

async function getManagementReview(identity, reviewId) {
  const actor = await account.resolveAccount(identity);
  return withTransaction(async (connection) => {
    authorization.assertAnyCapability(
      await authorization.getCapabilities(connection, actor.id), ADMIN_CAPABILITIES,
    );
    const row = await repository.findManagementReviewById(connection, reviewId);
    if (!row) throw new DomainError('RESOURCE_NOT_FOUND');
    return mapper.toManagementReviewDetail(row);
  });
}

/** 摊主的未结影响复核数量：未结复核期间相关证据不得按期限清理。 */
async function countOpenReviewsByVendorInTransaction(connection, { vendorId }) {
  return repository.countOpenReviewsByVendor(connection, vendorId);
}

module.exports = {
  listMyReviews, getMyReview, listManagementReviews, getManagementReview,
  countOpenReviewsByVendorInTransaction,
};

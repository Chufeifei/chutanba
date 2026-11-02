const { withTransaction } = require('../../../db/transaction');
const { nowMs } = require('../../../db/clock');
const { DomainError } = require('../../../domain/errors');
const account = require('../../account');
const audit = require('../../audit');
const operation = require('../../operation');
const repository = require('../repository');
const schema = require('../schema');
const { conflict, parseRef } = require('./guards');

const OPERATION_TYPE = 'PROFILE_SUBMIT';

async function createVendor(connection, accountId, occurredAtMs) {
  const vendorId = await repository.insertVendor(connection, {
    accountId, placeholderCode: `P${accountId}`, nowMs: occurredAtMs,
  });
  // 首次创建摊主时在同一事务把 vendor_code 定为 V + 左补零 ID，客户端不能自填。
  await repository.updateVendorCode(connection, {
    vendorId, vendorCode: `V${String(vendorId).padStart(12, '0')}`,
  });
  return repository.findVendorByIdForUpdate(connection, vendorId);
}

/** 账号行锁串行化首次申请；已有摊主时以其摊主行锁为唯一串行点。 */
async function resolveWritableVendor(connection, { actorId, expectedVendorVersion, occurredAtMs }) {
  await repository.lockAccount(connection, actorId);
  let vendor = await repository.findVendorByAccountForUpdate(connection, actorId);
  const existed = Boolean(vendor);
  if (!vendor) {
    // 首次申请没有既有摊主，客户端只能以 0 作为版本基准；新摊主行从 1 开始。
    if (expectedVendorVersion !== 0) throw conflict('vendor', 0);
    vendor = await createVendor(connection, actorId, occurredAtMs);
  }
  if (vendor.lifecycle_status !== 'ACTIVE') throw new DomainError('NOT_ELIGIBLE');
  if (existed && expectedVendorVersion !== Number(vendor.state_version)) {
    throw conflict('vendor', Number(vendor.state_version));
  }
  return vendor;
}

async function executeSubmit(connection, { actorId, input, operationId }) {
  const occurredAtMs = await nowMs(connection);
  const vendor = await resolveWritableVendor(connection, {
    actorId, expectedVendorVersion: input.expectedVendorVersion, occurredAtMs,
  });
  const latest = await repository.findLatestVersionNoForUpdate(connection, vendor.id);
  const pending = await repository.findPendingVersionForUpdate(connection, vendor.id);
  if (pending) throw conflict('profileSubmission');
  const versionNo = (latest === null ? 0 : latest) + 1;
  const versionId = await repository.insertPendingVersion(connection, {
    vendorId: Number(vendor.id), versionNo, input, submittedAtMs: occurredAtMs,
  });
  await repository.updateVendorStateVersion(connection, {
    vendorId: Number(vendor.id), nowMs: occurredAtMs,
  });
  await audit.record(connection, {
    actionCode: 'PROFILE_SUBMITTED',
    actorAccountId: actorId,
    targetType: 'PROFILE_VERSION',
    targetId: versionId,
    occurredAtMs,
    resultCode: 'SUCCESS',
    operationId,
    retentionClass: 'GENERAL',
  });
  return {
    submissionId: String(versionId),
    versionNo,
    reviewStatus: 'PENDING',
    stateVersion: Number(vendor.state_version) + 1,
  };
}

async function reloadSubmission(resultRef) {
  const versionId = parseRef(resultRef, 'pv');
  return withTransaction(async (connection) => {
    const version = await repository.findVersionById(connection, versionId);
    const vendor = version ? await repository.findVendorById(connection, version.vendor_id) : null;
    if (!vendor) throw new DomainError('STATE_CONFLICT', '提交结果不可用，请重试');
    return {
      submissionId: String(version.id),
      versionNo: Number(version.version_no),
      reviewStatus: version.review_status,
      stateVersion: Number(vendor.state_version),
    };
  });
}

function unwrap(outcome, payload) {
  if (outcome.status === 'PROCESSING') return outcome;
  if (outcome.status === 'FAILED') throw new DomainError(outcome.bizCode);
  return { ...(outcome.replayed ? outcome.result : payload), replayed: outcome.replayed };
}

async function submit(identity, key, body) {
  const actor = await account.resolveAccount(identity);
  const input = schema.normalizeSubmission(body);
  let payload = null;
  const outcome = await operation.executeIdempotent({
    actorScope: `account:${actor.id}`,
    operationType: OPERATION_TYPE,
    key,
    request: input,
    execute: async (connection, operationId) => {
      payload = await executeSubmit(connection, { actorId: actor.id, input, operationId });
      return { resultRef: `pv:${payload.submissionId}` };
    },
    reload: reloadSubmission,
  });
  return unwrap(outcome, payload);
}

module.exports = { submit };

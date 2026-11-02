const { withTransaction } = require('../../db/transaction');
const { nowMs } = require('../../db/clock');
const { DomainError } = require('../../domain/errors');
const { canonicalJson, sha256Hex } = require('../../utils/digest');
const { assertIdempotencyKey, assertOperationIdentity } = require('./schema');
const repository = require('./repository');

async function replay(connection, { actorScope, operationType, keyHash, requestHash, reload }) {
  const row = await repository.findOperation(connection, { actorScope, operationType, keyHash });
  if (!row) throw new DomainError('STATE_CONFLICT', '幂等操作状态不可用，请重试');
  if (row.request_hash !== requestHash) throw new DomainError('IDEMPOTENCY_MISMATCH');
  if (row.status === 'SUCCEEDED') {
    return { replayed: true, resultRef: row.result_ref, result: await reload(row.result_ref) };
  }
  if (row.status === 'PENDING') return { replayed: true, status: 'PROCESSING' };
  return { replayed: true, status: 'FAILED', bizCode: row.error_code };
}

function replayKey({ actorScope, operationType, keyHash, requestHash, reload }) {
  return withTransaction((connection) => replay(connection, {
    actorScope, operationType, keyHash, requestHash, reload,
  }));
}

async function markFailure({ actorScope, operationType, keyHash, errorCode }) {
  try {
    await withTransaction(async (connection) => {
      const row = await repository.findOperation(connection, { actorScope, operationType, keyHash });
      if (!row || row.status !== 'PENDING') return;
      const completedAtMs = await nowMs(connection);
      await repository.markFailed(connection, { operationId: row.id, errorCode, completedAtMs });
    });
  } catch (error) {
    // 失败状态写入失败不能覆盖原业务错误；原键仍可查询 PENDING。
    console.error('幂等操作失败状态写入失败', error.message);
  }
}

async function reserveOperation({ actorScope, operationType, keyHash, requestHash }) {
  try {
    return await withTransaction(async (connection) => {
      const occurredAtMs = await nowMs(connection);
      return repository.insertPending(connection, {
        actorScope, operationType, keyHash, requestHash, nowMs: occurredAtMs,
      });
    });
  } catch (error) {
    // 唯一键冲突表示已有请求持有该键，由调用方读取原记录并回放。
    if (error.code === 'ER_DUP_ENTRY') return null;
    throw error;
  }
}

async function executeReserved({ operationId, execute, actorScope, operationType, keyHash }) {
  try {
    return await withTransaction(async (connection) => {
      const outcome = await execute(connection, operationId);
      const completedAtMs = await nowMs(connection);
      const changed = await repository.markSucceeded(connection, {
        operationId, resultRef: outcome.resultRef, completedAtMs,
      });
      if (changed === 0) throw new DomainError('STATE_CONFLICT', '幂等操作状态已变化');
      return { replayed: false, resultRef: outcome.resultRef };
    });
  } catch (error) {
    if (error && error.name === 'DomainError') {
      await markFailure({ actorScope, operationType, keyHash, errorCode: error.bizCode });
    }
    throw error;
  }
}

/**
 * 先提交 PENDING 再执行业务：若提交结果无法确认，原键仍能查到 PROCESSING，
 * 不会因为业务事务回滚把“可能已成立”误报为 FAILED。
 */
async function executeIdempotent({ actorScope, operationType, key, request, execute, reload }) {
  assertOperationIdentity(actorScope, operationType);
  assertIdempotencyKey(key);
  const keyHash = sha256Hex(key);
  const requestHash = sha256Hex(canonicalJson(request));
  const context = { actorScope, operationType, keyHash, requestHash };
  const operationId = await reserveOperation(context);
  if (operationId === null) return replayKey({ ...context, reload });
  return executeReserved({ operationId, execute, actorScope, operationType, keyHash });
}

/** 只按本作用域查询；无记录统一 RESOURCE_NOT_FOUND，避免泄露他人操作键是否存在。 */
async function getOperationStatus(actorScope, operationType, key) {
  assertOperationIdentity(actorScope, operationType);
  const keyHash = sha256Hex(assertIdempotencyKey(key));
  return withTransaction(async (connection) => {
    const row = await repository.findOperation(connection, { actorScope, operationType, keyHash });
    if (!row) throw new DomainError('RESOURCE_NOT_FOUND');
    const result = { operationType, status: 'PROCESSING' };
    if (row.status === 'SUCCEEDED') {
      result.status = 'SUCCEEDED';
      result.resultRef = row.result_ref;
    } else if (row.status === 'FAILED') {
      result.status = 'FAILED';
      result.bizCode = row.error_code;
    }
    return result;
  });
}

module.exports = { executeIdempotent, getOperationStatus };

/**
 * 共用结束契约：手动收摊、到期、本人停止、治理暂停、管理纠错共用的唯一结束入口。
 * 需求出处：prd R5 与 doc/MVP/一期技术设计.md §7.2 —— 任何旁路写终态都视为缺陷。
 *
 * 调用方必须先锁摊主行；本函数只负责锁轮次、写终态、停止位置、清指针与审计。
 */
const audit = require('../../audit');
const repository = require('../repository');

function terminalOf(row) {
  return {
    row,
    endedAtMs: Number(row.ended_at_ms),
    endReason: row.end_reason,
    alreadyEnded: true,
  };
}

async function endSessionInTransaction(connection, {
  vendor, sessionId, endedAtMs, endReason, actorAccountId, operationId, occurredAtMs,
}) {
  const row = await repository.findSessionById(connection, sessionId, { forUpdate: true });
  // 已结束的轮次不重复写终态、不重复审计：并发收摊的后到者拿到同一结果。
  if (row.ended_at_ms !== null) return terminalOf(row);

  const changed = await repository.endSessionRow(connection, { sessionId, endedAtMs, endReason });
  if (changed === 0) {
    const current = await repository.findSessionById(connection, sessionId, { forUpdate: true });
    return terminalOf(current);
  }

  await repository.stopOpenLocations(connection, { sessionId, stoppedAtMs: endedAtMs, stopReason: endReason });
  await repository.clearVendorSession(connection, { vendorId: vendor.id, sessionId, nowMs: endedAtMs });
  await audit.record(connection, {
    actionCode: 'SESSION_ENDED',
    actorAccountId,
    targetType: 'SESSION',
    targetId: Number(sessionId),
    occurredAtMs,
    resultCode: 'SUCCESS',
    reasonSummary: endReason,
    operationId,
    retentionClass: 'GENERAL',
  });

  const ended = { ...row, ended_at_ms: endedAtMs, end_reason: endReason };
  return { row: { ...ended, version: Number(row.version) + 1 }, endedAtMs, endReason, alreadyEnded: false };
}

/**
 * 按摊主当前指针结束在途轮次：已到期用 E 与 DEADLINE，未到期用 N 与调用方给的原因。
 * 本人停止、治理暂停复用它，保证“结束轮次 + 写限制列”在同一事务、同一时刻口径。
 */
async function endCurrentSessionInTransaction(connection, {
  vendor, actorAccountId, operationId, occurredAtMs, reason,
}) {
  if (vendor.current_session_id === null) return null;
  const current = await repository.findSessionById(connection, vendor.current_session_id, { forUpdate: true });
  if (!current || current.ended_at_ms !== null) return null;
  const plannedEndAtMs = Number(current.planned_end_at_ms);
  const deadline = occurredAtMs >= plannedEndAtMs;
  return endSessionInTransaction(connection, {
    vendor,
    sessionId: Number(current.id),
    endedAtMs: deadline ? plannedEndAtMs : occurredAtMs,
    endReason: deadline ? 'DEADLINE' : reason,
    actorAccountId,
    operationId,
    occurredAtMs,
  });
}

module.exports = { endSessionInTransaction, endCurrentSessionInTransaction };

/** 审计只追加，不更新、不删除；调用方必须传入业务事务的同一连接。 */
async function insertEvent(connection, event) {
  const [result] = await connection.execute(
    `INSERT INTO cb_audit_event
       (action_code, actor_account_id, target_type, target_id, occurred_at_ms,
        result_code, reason_summary, operation_id, retention_class)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.actionCode, event.actorAccountId, event.targetType, event.targetId,
      event.occurredAtMs, event.resultCode, event.reasonSummary, event.operationId,
      event.retentionClass],
  );
  return Number(result.insertId);
}

module.exports = { insertEvent };

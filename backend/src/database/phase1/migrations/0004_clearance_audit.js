module.exports = {
  description: 'Phase-one clearance, retention, audit and replay records',
  statements: [
    `CREATE TABLE cb_data_clear_requests (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account_id BIGINT NOT NULL,
      vendor_id BIGINT NULL,
      scope_json JSON NOT NULL,
      status VARCHAR(24) COLLATE utf8mb4_bin NOT NULL DEFAULT 'QUEUED',
      accepted_at_ms BIGINT NOT NULL,
      due_at_ms BIGINT NOT NULL,
      completed_at_ms BIGINT NULL,
      result_summary_json JSON NULL,
      KEY ix_clear_account (account_id, accepted_at_ms, id),
      KEY ix_clear_vendor (vendor_id),
      KEY ix_clear_due (status, due_at_ms, id),
      CONSTRAINT ck_clear_deadline CHECK (due_at_ms >= accepted_at_ms),
      CONSTRAINT ck_clear_completion CHECK (completed_at_ms IS NULL OR completed_at_ms >= accepted_at_ms)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE cb_retention_holds (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      target_type VARCHAR(40) COLLATE utf8mb4_bin NOT NULL,
      target_id BIGINT NOT NULL,
      source_type VARCHAR(40) COLLATE utf8mb4_bin NOT NULL,
      source_id BIGINT NOT NULL,
      basis VARCHAR(1000) NOT NULL,
      opened_at_ms BIGINT NOT NULL,
      closed_at_ms BIGINT NULL,
      extended_due_at_ms BIGINT NULL,
      KEY ix_hold_target (target_type, target_id, closed_at_ms),
      KEY ix_hold_source (source_type, source_id),
      KEY ix_hold_expiry (closed_at_ms, extended_due_at_ms),
      CONSTRAINT ck_hold_close CHECK (closed_at_ms IS NULL OR closed_at_ms >= opened_at_ms),
      CONSTRAINT ck_hold_extension CHECK (extended_due_at_ms IS NULL OR extended_due_at_ms >= opened_at_ms)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    // General audit and replay records must never copy precise coordinate evidence.
    `CREATE TABLE cb_audit_events (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      action_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      actor_account_id BIGINT NULL,
      target_type VARCHAR(40) COLLATE utf8mb4_bin NOT NULL,
      target_id BIGINT NOT NULL,
      occurred_at_ms BIGINT NOT NULL,
      result_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      reason_summary VARCHAR(1000) NULL,
      operation_id BIGINT NOT NULL,
      retention_class VARCHAR(40) COLLATE utf8mb4_bin NOT NULL,
      KEY ix_audit_target (target_type, target_id, occurred_at_ms, id),
      KEY ix_audit_actor (actor_account_id, occurred_at_ms, id),
      KEY ix_audit_operation (operation_id),
      KEY ix_audit_retention (retention_class, occurred_at_ms, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE cb_idempotency_operations (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      actor_scope VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
      operation_type VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      key_hash BINARY(32) NOT NULL,
      request_hash BINARY(32) NOT NULL,
      status VARCHAR(16) COLLATE utf8mb4_bin NOT NULL DEFAULT 'PROCESSING',
      result_ref JSON NULL,
      created_at_ms BIGINT NOT NULL,
      completed_at_ms BIGINT NULL,
      UNIQUE KEY uq_operation_replay (actor_scope, operation_type, key_hash),
      KEY ix_operation_retention (completed_at_ms, id),
      CONSTRAINT ck_operation_status CHECK (status IN ('PROCESSING','SUCCEEDED','FAILED')),
      CONSTRAINT ck_operation_completion CHECK ((status = 'PROCESSING' AND completed_at_ms IS NULL) OR (status <> 'PROCESSING' AND completed_at_ms IS NOT NULL AND completed_at_ms >= created_at_ms))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE cb_pilot_events (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      event_type VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      dedupe_ref VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
      account_id BIGINT NULL,
      vendor_id BIGINT NULL,
      session_id BIGINT NULL,
      occurred_at_ms BIGINT NOT NULL,
      outcome VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      UNIQUE KEY uq_pilot_dedupe (event_type, dedupe_ref),
      KEY ix_pilot_time (event_type, occurred_at_ms, id),
      KEY ix_pilot_account (account_id),
      KEY ix_pilot_vendor (vendor_id),
      KEY ix_pilot_session (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ]
};

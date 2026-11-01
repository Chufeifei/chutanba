module.exports = {
  description: 'Phase-one accounts, controlled grants and versioned profile review',
  statements: [
    `CREATE TABLE cb_accounts (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      wx_openid VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
      version BIGINT NOT NULL DEFAULT 1,
      created_at_ms BIGINT NOT NULL,
      last_seen_at_ms BIGINT NOT NULL,
      UNIQUE KEY uq_account_openid (wx_openid)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE cb_management_grants (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account_id BIGINT NOT NULL,
      role_code VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
      status VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
      source VARCHAR(128) NOT NULL,
      valid_from_ms BIGINT NOT NULL,
      valid_until_ms BIGINT NULL,
      KEY ix_grant_account_status (account_id, status, valid_until_ms),
      CONSTRAINT ck_grant_role CHECK (role_code IN ('PROFILE_REVIEWER','FIELD_REVIEWER','ADMIN','SUPER_ADMIN')),
      CONSTRAINT ck_grant_status CHECK (status IN ('ACTIVE','REVOKED')),
      CONSTRAINT ck_grant_window CHECK (valid_until_ms IS NULL OR valid_until_ms > valid_from_ms)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE cb_vendors (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account_id BIGINT NOT NULL,
      active_profile_version_id BIGINT NULL,
      current_session_id BIGINT NULL,
      state_version BIGINT NOT NULL DEFAULT 1,
      last_selected_clock_min SMALLINT NULL,
      created_at_ms BIGINT NOT NULL,
      UNIQUE KEY uq_vendor_account (account_id),
      KEY ix_vendor_active_profile (active_profile_version_id),
      KEY ix_vendor_current_session (current_session_id),
      CONSTRAINT ck_vendor_clock CHECK (last_selected_clock_min BETWEEN 0 AND 1439)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE cb_vendor_profile_versions (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      vendor_id BIGINT NOT NULL,
      version_no BIGINT NOT NULL,
      task_version BIGINT NOT NULL DEFAULT 1,
      vendor_name VARCHAR(40) NOT NULL,
      category_code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
      regular_items_text VARCHAR(200) NOT NULL,
      price_description VARCHAR(120) NOT NULL,
      announcement VARCHAR(300) NOT NULL,
      review_status VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
      submitted_at_ms BIGINT NOT NULL,
      decided_at_ms BIGINT NULL,
      pending_vendor_id BIGINT GENERATED ALWAYS AS (CASE WHEN review_status = 'PENDING' THEN vendor_id ELSE NULL END) STORED,
      UNIQUE KEY uq_profile_version (vendor_id, version_no),
      UNIQUE KEY uq_profile_pending (pending_vendor_id),
      KEY ix_profile_review_queue (review_status, submitted_at_ms, id),
      CONSTRAINT ck_profile_status CHECK (review_status IN ('PENDING','APPROVED','REJECTED','INVALIDATED')),
      CONSTRAINT ck_profile_version CHECK (version_no > 0 AND task_version > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE cb_profile_review_events (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      profile_version_id BIGINT NOT NULL,
      decision VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
      reason VARCHAR(1000) NULL,
      actor_account_id BIGINT NOT NULL,
      decided_at_ms BIGINT NOT NULL,
      operation_id BIGINT NOT NULL,
      UNIQUE KEY uq_profile_terminal_review (profile_version_id),
      KEY ix_profile_review_actor (actor_account_id, decided_at_ms),
      KEY ix_profile_review_operation (operation_id),
      CONSTRAINT ck_profile_decision CHECK (decision IN ('APPROVE','REJECT')),
      CONSTRAINT ck_profile_rejection_reason CHECK (decision <> 'REJECT' OR (reason IS NOT NULL AND CHAR_LENGTH(TRIM(reason)) > 0))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ]
};

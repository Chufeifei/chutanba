module.exports = {
  description: 'Phase-one operating sessions, locations and independent publication controls',
  statements: [
    `CREATE TABLE cb_vendor_sessions (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      vendor_id BIGINT NOT NULL,
      profile_version_id BIGINT NOT NULL,
      started_at_ms BIGINT NOT NULL,
      planned_end_at_ms BIGINT NOT NULL,
      ended_at_ms BIGINT NULL,
      end_reason VARCHAR(16) COLLATE utf8mb4_bin NULL,
      version BIGINT NOT NULL DEFAULT 1,
      unfinished_vendor_id BIGINT GENERATED ALWAYS AS (CASE WHEN ended_at_ms IS NULL THEN vendor_id ELSE NULL END) STORED,
      UNIQUE KEY uq_session_unfinished (unfinished_vendor_id),
      KEY ix_session_vendor_history (vendor_id, started_at_ms, id),
      KEY ix_session_expiry (ended_at_ms, planned_end_at_ms),
      KEY ix_session_profile (profile_version_id),
      CONSTRAINT ck_session_window CHECK (planned_end_at_ms > started_at_ms),
      CONSTRAINT ck_session_end CHECK ((ended_at_ms IS NULL AND end_reason IS NULL) OR (ended_at_ms IS NOT NULL AND ended_at_ms >= started_at_ms AND end_reason IS NOT NULL)),
      CONSTRAINT ck_session_end_reason CHECK (end_reason IN ('MANUAL','DEADLINE','SELF_STOP','GOVERNANCE','CORRECTION'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE cb_vendor_open_attempts (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      vendor_id BIGINT NOT NULL,
      planned_end_at_ms BIGINT NOT NULL,
      status VARCHAR(24) COLLATE utf8mb4_bin NOT NULL,
      accepted_at_ms BIGINT NOT NULL,
      finished_at_ms BIGINT NULL,
      session_id BIGINT NULL,
      KEY ix_attempt_vendor (vendor_id, accepted_at_ms, id),
      UNIQUE KEY uq_attempt_session (session_id),
      CONSTRAINT ck_attempt_status CHECK (status IN ('LOCATING','SUCCEEDED','LOCATION_FAILED','TIME_FAILED','CANCELLED')),
      CONSTRAINT ck_attempt_finish CHECK ((status = 'LOCATING' AND finished_at_ms IS NULL AND session_id IS NULL) OR (status <> 'LOCATING' AND finished_at_ms IS NOT NULL AND finished_at_ms >= accepted_at_ms AND ((status = 'SUCCEEDED' AND session_id IS NOT NULL) OR (status <> 'SUCCEEDED' AND session_id IS NULL))))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    // Coordinates may be erased by retention processing without deleting fact IDs.
    // Business writes must require a pair before publishing a new location.
    `CREATE TABLE cb_session_locations (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      session_id BIGINT NOT NULL,
      vendor_id BIGINT NOT NULL,
      version_no BIGINT NOT NULL,
      lat DECIMAL(10,7) NULL,
      lng DECIMAL(11,7) NULL,
      location_name VARCHAR(300) NULL,
      located_at_ms BIGINT NOT NULL,
      effective_at_ms BIGINT NOT NULL,
      stopped_at_ms BIGINT NULL,
      stop_reason VARCHAR(16) COLLATE utf8mb4_bin NULL,
      unstopped_session_id BIGINT GENERATED ALWAYS AS (CASE WHEN stopped_at_ms IS NULL THEN session_id ELSE NULL END) STORED,
      UNIQUE KEY uq_location_version (session_id, version_no),
      UNIQUE KEY uq_location_unstopped (unstopped_session_id),
      KEY ix_location_vendor (vendor_id, effective_at_ms, id),
      KEY ix_location_retention (stopped_at_ms, id),
      CONSTRAINT ck_location_lat CHECK (lat BETWEEN -90 AND 90),
      CONSTRAINT ck_location_lng CHECK (lng BETWEEN -180 AND 180),
      CONSTRAINT ck_location_coordinate_pair CHECK ((lat IS NULL AND lng IS NULL) OR (lat IS NOT NULL AND lng IS NOT NULL)),
      CONSTRAINT ck_location_active_coordinates CHECK (stopped_at_ms IS NOT NULL OR (lat IS NOT NULL AND lng IS NOT NULL AND location_name IS NOT NULL)),
      CONSTRAINT ck_location_version CHECK (version_no > 0),
      CONSTRAINT ck_location_stop CHECK ((stopped_at_ms IS NULL AND stop_reason IS NULL) OR (stopped_at_ms IS NOT NULL AND stopped_at_ms >= effective_at_ms AND stop_reason IS NOT NULL)),
      CONSTRAINT ck_location_stop_reason CHECK (stop_reason IN ('SUPERSEDED','MANUAL','DEADLINE','SELF_STOP','GOVERNANCE','CORRECTION'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE cb_vendor_open_days (
      vendor_id BIGINT NOT NULL,
      open_date DATE NOT NULL,
      first_session_id BIGINT NOT NULL,
      created_at_ms BIGINT NOT NULL,
      PRIMARY KEY (vendor_id, open_date),
      KEY ix_open_day_session (first_session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE cb_publication_controls (
      vendor_id BIGINT NOT NULL PRIMARY KEY,
      self_stopped_at_ms BIGINT NULL,
      self_version BIGINT NOT NULL DEFAULT 1,
      governance_paused_at_ms BIGINT NULL,
      governance_version BIGINT NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE cb_location_contexts (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      token_hash BINARY(32) NOT NULL,
      account_id BIGINT NOT NULL,
      purpose VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
      target_id BIGINT NULL,
      issued_at_ms BIGINT NOT NULL,
      expires_at_ms BIGINT NOT NULL,
      used_at_ms BIGINT NULL,
      UNIQUE KEY uq_location_context_token (token_hash),
      KEY ix_location_context_account (account_id, purpose, target_id),
      KEY ix_location_context_expiry (expires_at_ms),
      CONSTRAINT ck_location_context_purpose CHECK (purpose IN ('OPEN','REFRESH','FEEDBACK')),
      CONSTRAINT ck_location_context_window CHECK (expires_at_ms > issued_at_ms AND expires_at_ms <= issued_at_ms + 300000),
      CONSTRAINT ck_location_context_used CHECK (used_at_ms IS NULL OR (used_at_ms >= issued_at_ms AND used_at_ms <= expires_at_ms))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ]
};

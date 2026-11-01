const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPhase1Migrations } = require('../src/database/phase1/migration-runner');

function tables() {
  return new Map(loadPhase1Migrations().flatMap(m => m.statements).map(sql => {
    const match = sql.match(/^\s*CREATE TABLE (cb_\w+)\s*\(/i);
    assert.ok(match, 'Each schema statement must create a named table');
    return [match[1], sql.replace(/\s+/g, ' ')];
  }));
}

test('phase-one identity and operating tables are available to later work packages', () => {
  const schema = tables();
  for (const name of ['cb_accounts', 'cb_management_grants', 'cb_vendors', 'cb_vendor_profile_versions', 'cb_profile_review_events', 'cb_vendor_sessions', 'cb_vendor_open_attempts', 'cb_session_locations', 'cb_vendor_open_days', 'cb_publication_controls', 'cb_location_contexts']) {
    assert.ok(schema.has(name), `Missing ${name}`);
    assert.match(schema.get(name), /ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/);
    assert.doesNotMatch(schema.get(name), /FOREIGN KEY|RECENT_LAST/i);
  }
});

test('identity, profile sequence and terminal review have unique keys', () => {
  const schema = tables();
  for (const [name, columns] of [['cb_accounts', 'wx_openid'], ['cb_vendors', 'account_id'], ['cb_vendor_profile_versions', 'vendor_id, version_no'], ['cb_profile_review_events', 'profile_version_id'], ['cb_location_contexts', 'token_hash']]) {
    assert.match(schema.get(name) || '', new RegExp(`UNIQUE KEY \\w+ \\(${columns}\\)`));
  }
});

test('nullable generated unique keys guard pending profiles and active session/location rows', () => {
  const schema = tables();
  for (const [name, predicate, owner, key] of [
    ['cb_vendor_profile_versions', "review_status = 'PENDING'", 'vendor_id', 'pending_vendor_id'],
    ['cb_vendor_sessions', 'ended_at_ms IS NULL', 'vendor_id', 'unfinished_vendor_id'],
    ['cb_session_locations', 'stopped_at_ms IS NULL', 'session_id', 'unstopped_session_id']
  ]) {
    const sql = schema.get(name) || '';
    assert.ok(sql.includes(`${key} BIGINT GENERATED ALWAYS AS (CASE WHEN ${predicate} THEN ${owner} ELSE NULL END) STORED`), name);
    assert.match(sql, new RegExp(`UNIQUE KEY \\w+ \\(${key}\\)`));
  }
});

test('location precision, range and version identity are preserved', () => {
  const sql = tables().get('cb_session_locations') || '';
  assert.match(sql, /lat DECIMAL\(10,7\) NULL/);
  assert.match(sql, /lng DECIMAL\(11,7\) NULL/);
  assert.match(sql, /CHECK \(lat BETWEEN -90 AND 90\)/);
  assert.match(sql, /CHECK \(lng BETWEEN -180 AND 180\)/);
  assert.match(sql, /UNIQUE KEY \w+ \(session_id, version_no\)/);
  assert.match(sql, /effective_at_ms BIGINT NOT NULL/);
  assert.match(sql, /stopped_at_ms BIGINT NULL/);
});

test('feedback and lifecycle tables retain contract domains without foreign keys', () => {
  const schema = tables();
  for (const name of ['cb_feedback_observations', 'cb_navigation_checks', 'cb_feedback_cases', 'cb_feedback_facts', 'cb_feedback_review_events', 'cb_feedback_fact_decisions', 'cb_management_actions', 'cb_vendor_impact_records', 'cb_impact_review_requests', 'cb_data_clear_requests', 'cb_retention_holds', 'cb_audit_events', 'cb_idempotency_operations', 'cb_pilot_events']) {
    assert.ok(schema.has(name), `Missing ${name}`);
    assert.match(schema.get(name), /ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/);
    assert.doesNotMatch(schema.get(name), /FOREIGN KEY/i);
  }
});

test('feedback decisions, operation replay and pilot facts cannot be duplicated', () => {
  const schema = tables();
  for (const [name, columns] of [
    ['cb_feedback_facts', 'reporter_account_id, observation_id, feedback_type'],
    ['cb_feedback_review_events', 'case_id'], ['cb_feedback_fact_decisions', 'fact_id'],
    ['cb_vendor_impact_records', 'source_type, source_id'],
    ['cb_idempotency_operations', 'actor_scope, operation_type, key_hash'],
    ['cb_pilot_events', 'event_type, dedupe_ref']
  ]) assert.match(schema.get(name) || '', new RegExp(`UNIQUE KEY \\w+ \\(${columns}\\)`), name);
});

test('pending case grouping and impact appeals use database uniqueness', () => {
  const schema = tables();
  assert.match(schema.get('cb_feedback_cases') || '', /pending_marker TINYINT GENERATED ALWAYS AS \(CASE WHEN status = 'PENDING' THEN 1 ELSE NULL END\) STORED/);
  assert.match(schema.get('cb_feedback_cases') || '', /UNIQUE KEY \w+ \(reporter_account_id, vendor_id, event_date, feedback_type, pending_marker\)/);
  assert.match(schema.get('cb_impact_review_requests') || '', /pending_impact_id BIGINT GENERATED ALWAYS AS \(CASE WHEN status = 'PENDING' THEN impact_record_id ELSE NULL END\) STORED/);
  assert.match(schema.get('cb_impact_review_requests') || '', /UNIQUE KEY \w+ \(pending_impact_id\)/);
});

test('restricted feedback coordinates are erasable decimal pairs with range checks', () => {
  const sql = tables().get('cb_feedback_facts') || '';
  assert.match(sql, /reporter_lat DECIMAL\(10,7\) NULL/);
  assert.match(sql, /reporter_lng DECIMAL\(11,7\) NULL/);
  assert.match(sql, /CHECK \(reporter_lat BETWEEN -90 AND 90\)/);
  assert.match(sql, /CHECK \(reporter_lng BETWEEN -180 AND 180\)/);
  assert.match(sql, /reporter_lat IS NULL AND reporter_lng IS NULL/);
  for (const name of ['cb_feedback_observations', 'cb_navigation_checks', 'cb_audit_events', 'cb_idempotency_operations', 'cb_pilot_events']) {
    assert.doesNotMatch(tables().get(name) || '', /\b(?:lat|lng|reporter_lat|reporter_lng)\b/i, name);
  }
});

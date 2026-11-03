const assert = require('node:assert/strict');
const test = require('node:test');

const { loadPhase1Migrations } = require('../src/database/phase1/migration-runner');

function schema() {
  try {
    return loadPhase1Migrations().flatMap(({ statements }) => statements).join('\n');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

test('identity and profile migration creates the contracted tables', () => {
  const sql = schema();
  for (const name of [
    'cb_user_account', 'cb_vendor_identity', 'cb_user_role', 'cb_admin_permission',
    'cb_admin_permission_grant', 'cb_admin_authorization_event',
    'cb_vendor_profile_version', 'cb_profile_review_event',
  ]) assert.match(sql, new RegExp(`CREATE TABLE ${name}\\s*\\(`));
});

test('session and location migration creates the contracted tables', () => {
  const sql = schema();
  for (const name of [
    'cb_vendor_open_attempt', 'cb_vendor_session', 'cb_session_location',
    'cb_vendor_open_day', 'cb_vendor_publication_control', 'cb_location_context',
  ]) assert.match(sql, new RegExp(`CREATE TABLE ${name}\\s*\\(`));
});

test('active profile, session and location rows have conditional unique keys', () => {
  const sql = schema();
  for (const column of ['pending_vendor_id', 'active_vendor_id', 'active_session_id']) {
    assert.match(sql, new RegExp(`${column}[^,]*GENERATED ALWAYS AS`, 'i'));
    assert.match(sql, new RegExp(`UNIQUE KEY uq_[^\\s]+ \\(${column}\\)`, 'i'));
  }
});

test('locations use precise coordinates and no physical foreign keys', () => {
  const sql = schema();
  assert.match(sql, /lat DECIMAL\(10,7\)/i);
  assert.match(sql, /lng DECIMAL\(11,7\)/i);
  assert.doesNotMatch(sql, /FOREIGN KEY|REFERENCES\s+cb_/i);
});

test('feedback and governance migration creates contracted fact and decision tables', () => {
  const sql = schema();
  for (const name of [
    'cb_feedback_observation', 'cb_navigation_check', 'cb_feedback_case',
    'cb_feedback_fact', 'cb_feedback_review_event', 'cb_feedback_fact_decision',
    'cb_management_action',
  ]) assert.match(sql, new RegExp(`CREATE TABLE ${name}\\s*\\(`));
  for (const key of [
    'uq_feedback_fact_dedupe', 'uq_feedback_case_pending',
    'uq_feedback_review_case', 'uq_fact_decision_fact',
  ]) assert.match(sql, new RegExp(`UNIQUE KEY ${key}\\s*\\(`));
});

test('clearance and audit migration creates contracted lifecycle tables', () => {
  const sql = schema();
  for (const name of [
    'cb_vendor_impact_record', 'cb_data_clear_request',
    'cb_vendor_impact_review_request', 'cb_retention_hold',
    'cb_audit_event', 'cb_idempotency_operation', 'cb_pilot_event',
  ]) assert.match(sql, new RegExp(`CREATE TABLE ${name}\\s*\\(`));
  for (const key of ['uq_impact_source', 'uq_idempotency_replay', 'uq_pilot_event_dedupe']) {
    assert.match(sql, new RegExp(`UNIQUE KEY ${key}\\s*\\(`));
  }
});

test('every new business table names a check constraint', () => {
  const statements = loadPhase1Migrations().flatMap(({ statements: items }) => items);
  for (const statement of statements) {
    const name = /^CREATE TABLE (cb_\w+)/.exec(statement)?.[1];
    if (!name) continue;
    const laterCheck = statements.some((candidate) =>
      candidate.startsWith(`ALTER TABLE ${name} ADD CONSTRAINT ck_`));
    assert.ok(/CONSTRAINT ck_[a-z0-9_]+ CHECK/i.test(statement) || laterCheck, name);
  }
});

test('every business table ends up with a BIGINT id primary key', () => {
  const statements = loadPhase1Migrations().flatMap(({ statements: items }) => items);
  for (const statement of statements) {
    const name = /^CREATE TABLE (cb_\w+)/.exec(statement)?.[1];
    if (!name) continue;
    const addsId = statements.some((candidate) =>
      candidate.startsWith(`ALTER TABLE ${name}`) &&
      /ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY/i.test(candidate));
    assert.ok(/id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY/i.test(statement) || addsId, name);
  }
});

test('identity and code columns receive binary collation in the migration chain', () => {
  const statements = loadPhase1Migrations().flatMap(({ statements: items }) => items);
  for (const [table, column] of [
    ['cb_user_account', 'wx_openid'], ['cb_user_account', 'wx_unionid'],
    ['cb_vendor_identity', 'vendor_code'], ['cb_admin_permission', 'permission_code'],
    ['cb_vendor_profile_version', 'category_code'],
  ]) {
    const sql = statements.filter((item) => item.startsWith(`CREATE TABLE ${table} (`) ||
      item.startsWith(`ALTER TABLE ${table}\n`)).join('\n');
    assert.match(sql, new RegExp(`(?:MODIFY )?${column} VARCHAR\\([^)]*\\) COLLATE utf8mb4_bin`, 'i'), `${table}.${column}`);
  }
});

test('permission catalog gains numeric primary key while permission code stays unique', () => {
  const statements = loadPhase1Migrations().flatMap(({ statements: items }) => items).join('\n');
  assert.match(statements, /ALTER TABLE cb_admin_permission[\s\S]*ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY/i);
  assert.match(statements, /ADD UNIQUE KEY uq_admin_permission_code \(permission_code\)/i);
});

test('authorization event whitelists are enforced by the migration chain', () => {
  const statements = loadPhase1Migrations().flatMap(({ statements: items }) => items).join('\n');
  assert.match(statements, /ck_authorization_event_role CHECK \(role_code IS NULL OR role_code IN \('ADMIN','SUPER_ADMIN'\)\)/i);
  assert.match(statements, /ck_authorization_event_scope CHECK \(scope_type IS NULL OR scope_type IN \('NATIONAL','CITY','REGION'\)\)/i);
});

test('W2 migrations seed reviewer permissions and extend grant and operation rows', () => {
  const statements = loadPhase1Migrations().flatMap(({ statements: items }) => items).join('\n');
  assert.match(statements, /'PROFILE_REVIEWER'[\s\S]*'FIELD_REVIEWER'/);
  assert.match(statements, /MODIFY granted_by_account_id BIGINT UNSIGNED NULL/i);
  assert.match(statements, /ADD COLUMN error_code VARCHAR\(64\)[^,]*NULL/i);
});

test('W3 adds the profile review queue index without altering earlier tables', () => {
  const statements = loadPhase1Migrations().flatMap(({ statements: items }) => items);
  assert.ok(statements.some((statement) =>
    /ALTER TABLE cb_vendor_profile_version[\s\S]*ADD KEY ix_profile_status_submitted \(review_status, submitted_at_ms, id\)/i.test(statement)));
});

test('W5 adds navigation launch columns, unique ref and the session window index', () => {
  const statements = loadPhase1Migrations().flatMap(({ statements: items }) => items);
  assert.ok(statements.some((statement) => /ALTER TABLE cb_navigation_check[\s\S]*ADD COLUMN launched_at_ms BIGINT NULL/i.test(statement)));
  assert.ok(statements.some((statement) => /ALTER TABLE cb_navigation_check[\s\S]*ADD COLUMN launch_ref CHAR\(32\)[^,\n]*NULL/i.test(statement)));
  assert.ok(statements.some((statement) =>
    /ADD UNIQUE KEY uq_navigation_launch_ref \(launch_ref\)/i.test(statement)));
  assert.ok(statements.some((statement) =>
    /ADD CONSTRAINT ck_navigation_launch CHECK \(launched_at_ms IS NULL OR launched_at_ms >= created_at_ms\)/i.test(statement)));
  assert.ok(statements.some((statement) =>
    /ALTER TABLE cb_vendor_session[\s\S]*ADD KEY ix_session_active_end \(ended_at_ms, planned_end_at_ms\)/i.test(statement)));
});

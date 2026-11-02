# Phase 1 W1 Empty Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a clean phase-one MySQL schema and migration chain from an empty database.

**Baseline:** On 2026-11-01 the user deleted all legacy code, migrations and scripts. This plan runs against the new skeleton and must not restore or depend on the deleted legacy files.

**Architecture:** Add a phase-one migration directory and runner, independent of the removed legacy location migrations. Build DDL by domain and verify the live database constraints on an isolated MySQL instance.

**Tech Stack:** Node.js >=20, CommonJS, mysql2, MySQL 8, `node:test`.

**Spec:** `.trellis/tasks/11-01-phase1-w1-migration-baseline/prd.md` and `design.md`; field contract in `doc/MVP/一期数据模型与接口约定.md` §2–3.

## Global Constraints

- Start only from a new, empty schema; no legacy data conversion or old migration-history support.
- Preserve existing uncommitted files; do not restore the deleted legacy code or migrations.
- `utf8mb4`, UTC database sessions, millisecond Unix timestamps, GCJ-02 coordinates as `DECIMAL(10,7)`/`DECIMAL(11,7)`.
- No physical foreign keys; use indexes and business transactions for references.
- Never run DDL against a production database in this task.

## Review Focus

- A nonempty schema must be rejected before the first phase-one migration, including a schema containing only legacy tables (Task 1).
- A failed DDL statement must leave a clear failed migration name; retry must not pretend partial DDL rolled back (Task 1).
- Concurrent inserts must not permit two active rows where only one is allowed (Tasks 2–3).
- Large `BIGINT` IDs and millisecond values must not be rounded by JavaScript verification scripts (Task 4).
- The normal `npm run migrate` command must scan only the phase-one migration directory.

---

### Task 1: Isolated migration runner

**Files:** Create `backend/src/database/phase1/migration-runner.js`, `backend/test/phase1-migration-runner.test.js`.

**Interfaces:** `runPhase1Migrations(pool)`, `phase1MigrationStatus(pool)`, and `loadPhase1Migrations()` are exported. Runner accepts a mysql2 pool; status reports applied, pending, drift, and compatibility. Migration files export `statements` and optional `description`.

- [ ] Write tests for empty-schema first run, nonempty-schema rejection, checksum drift, repeat execution, lock failure, and mid-DDL failure naming the migration.
- [ ] Run `node --test backend/test/phase1-migration-runner.test.js` and confirm expected failures.
- [ ] Implement a dedicated directory scan, checksums, advisory lock, metadata bootstrap, ordered execution and status. Reject preexisting non-metadata tables on first run. Record a failed migration in the error; describe partial DDL as requiring inspection/rebuild.
- [ ] Run the same test command and confirm it passes.

### Task 2: Identity, profile, session and location schema

**Files:** Create `backend/src/database/phase1/migrations/0001_identity_profile.js`, `0002_sessions_locations.js`, `backend/test/phase1-schema-contract.test.js`.

**Interfaces:** Each migration exports an ordered nonempty `statements` array. Tables and columns follow the logical names in the data contract. W2–W4 will rely on `cb_accounts`, `cb_vendors`, `cb_vendor_profile_versions`, `cb_vendor_sessions`, `cb_session_locations` and the related support tables.

- [ ] Write structure checks for the named tables, `DECIMAL` coordinates, unique account identity, one pending profile per vendor, one unfinished session per vendor, and one unstopped location per session.
- [ ] Run `node --test backend/test/phase1-schema-contract.test.js` and confirm failures.
- [ ] Add DDL for account, management grant, vendor, profile version/review, open attempt, session, location version, open day, publication control and location context. Use nullable generated keys where uniqueness applies only to active rows.
- [ ] Run the structure checks and confirm they pass.

### Task 3: Feedback, governance and lifecycle schema

**Files:** Create `backend/src/database/phase1/migrations/0003_feedback_governance.js`, `0004_clearance_audit.js`; extend `backend/test/phase1-schema-contract.test.js`.

**Interfaces:** Tables follow contract §2 for observation, feedback case/fact/review/decision, management action, impact record/review, clear request, retention hold, audit event, idempotency operation and pilot event.

- [ ] Add failing checks for all remaining tables and unique business keys: fact dedupe, pending case, one terminal decision, operation replay key and pilot-event dedupe.
- [ ] Run the structure test and confirm failures.
- [ ] Add the remaining DDL with field types, indexes, enums/checks and no physical foreign keys.
- [ ] Run the structure test and confirm passes.

### Task 4: Live empty-MySQL verification

**Files:** Create `backend/scripts/verify-phase1-schema.js`, `backend/test/phase1-schema.integration.test.js`; add a short verification record under `.trellis/tasks/11-01-phase1-w1-migration-baseline/research/`.

**Interfaces:** Integration test reads isolated database connection settings, refuses a nonempty target, and prints the server version, schema name, migration list and constraint outcomes without credentials or sensitive data.

- [ ] Write failing integration cases for empty migrate/repeat/status, checksum drift on a disposable copy, generated unique-key concurrency, `DECIMAL` and `CHECK` behavior, and large integer handling.
- [ ] Run against an isolated MySQL instance matching the target version; confirm failures before completing DDL fixes.
- [ ] Make the minimum schema or runner corrections needed; rerun and preserve sanitized evidence. If no isolated MySQL is available, record these checks as blocked rather than passed.

### Task 5: Command wiring and documentation

**Files:** Modify `backend/package.json`, `backend/scripts/migrate.js`, `backend/scripts/migrate-status.js`; create `backend/README-phase1-migrations.md`, `backend/test/phase1-command.test.js`. Review the already revised `doc/MVP/一期实施计划.md` and `doc/MVP/一期开发准备进度.md`.

**Interfaces:** `npm run migrate` and `npm run migrate:status` use the phase-one runner only; they must not reference the deleted legacy migrations or scan outside the phase-one directory.

- [ ] Add a command-level test proving the package scripts resolve to the phase-one runner and do not scan outside the phase-one migration directory; run it red.
- [ ] Wire commands and document the empty-schema safety check and isolated verification procedure. Confirm G-02/G-03/W1 reflect the clean-start decision and W5 confirms the old public-coordinate routes are not reintroduced.
- [ ] Run command test, `npm --prefix backend run check`, `node --test backend/test/*.test.js`, and the live integration test when the isolated database is available.
- [ ] Review the diff for unrelated edits and report pass/fail evidence plus remaining environment gates. Do not mark W1 complete without live MySQL evidence.

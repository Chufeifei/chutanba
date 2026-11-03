/**
 * W7 集成用例：管理上下文、反馈复核与逐事实决定、当前轮次纠错、治理暂停恢复、本人影响记录。
 * 只连隔离库 phase1_test_w7；夹具以 w7-it- 前缀创建并在结束时清理。
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');

const isolatedDatabase = process.env.PHASE1_TEST_DATABASE;
const useNamedPipe = process.env.PHASE1_TEST_HTTP_PIPE === '1';
const namedPipePath = `\\\\.\\pipe\\chutanba-w7-it-${process.pid}`;

if (!isolatedDatabase) {
  test('W7 integration requires PHASE1_TEST_* credentials', { skip: '未提供 phase1_test_w7 隔离库凭据' }, () => {});
} else {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_DEV_IDENTITY = 'true';
  process.env.LOCATION_CONTEXT_SECRET = 'w7-location-secret';
  process.env.PUBLIC_TOKEN_SECRET = 'w7-public-secret';
  // 管理资格只来自部署名单：审核员与管理员各自一个 openid。
  process.env.FIELD_REVIEWER_OPENIDS = 'w7-it-reviewer';
  process.env.ADMIN_OPENIDS = 'w7-it-admin';
  process.env.DB_HOST = process.env.PHASE1_TEST_HOST || process.env.DB_HOST;
  process.env.DB_PORT = process.env.PHASE1_TEST_PORT || process.env.DB_PORT;
  process.env.DB_USER = process.env.PHASE1_TEST_USER;
  process.env.DB_PASSWORD = process.env.PHASE1_TEST_PASSWORD;
  process.env.DB_NAME = isolatedDatabase;
}

if (isolatedDatabase) {
  const app = require('../src/app');
  const { getPool, closeDatabase } = require('../src/db/pool');
  const { runPhase1Migrations } = require('../src/database/phase1/migration-runner');
  const { nowMs: dbNowMs } = require('../src/db/clock');
  const account = require('../src/modules/account');

  const MINUTE = 60_000;
  const identity = (openid) => ({ openid, unionid: null, userId: null, source: 'dev' });
  const ORIGIN = { lat: 31.2304, lng: 121.4737 };
  const NEAR = { lat: ORIGIN.lat + 0.00269, lng: ORIGIN.lng };
  let server = null;
  // 跨用例共享的夹具：后一个用例依赖前一个用例产生的结论与轮次状态。
  let fixture = null;

  async function httpRequest(path, { method = 'GET', openid, body, key } = {}) {
    const headers = {};
    const payload = body === undefined ? null : JSON.stringify(body);
    if (payload !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (openid) headers['X-Dev-Openid'] = openid;
    if (key) headers['Idempotency-Key'] = key;
    const target = useNamedPipe
      ? { socketPath: namedPipePath, path: `/api/v2${path}`, method, headers }
      : { host: '127.0.0.1', port: server.address().port, path: `/api/v2${path}`, method, headers };
    return new Promise((resolve, reject) => {
      const request = http.request(target, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: response.statusCode, body: text ? JSON.parse(text) : null });
        });
      });
      request.on('error', reject);
      if (payload !== null) request.write(payload);
      request.end();
    });
  }

  /** 首次访问同步部署名单授权：管理端点在 /me 之后才看得到能力。 */
  async function signIn(openid) {
    const me = await httpRequest('/me', { openid });
    assert.equal(me.status, 200, `${openid} /me 失败`);
    return me.body.data;
  }

  async function createVendor(openid, name = '老张烤冷面') {
    const actor = await account.resolveAccount(identity(openid));
    const pool = getPool();
    const now = Date.now();
    const [vendorResult] = await pool.execute(
      `INSERT INTO cb_vendor_identity
         (account_id, vendor_code, lifecycle_status, active_profile_version_id, state_version, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'ACTIVE', NULL, 1, ?, ?)`,
      [actor.id, `W7IT${String(actor.id).padStart(8, '0')}`, now, now],
    );
    const vendorId = Number(vendorResult.insertId);
    const [profileResult] = await pool.execute(
      `INSERT INTO cb_vendor_profile_version
         (vendor_id, version_no, vendor_name, category_code, regular_items_text,
          price_description, announcement, review_status, submitted_at_ms, decided_at_ms)
       VALUES (?, 1, ?, 'SNACK', '常卖内容', '价格说明', '公告', 'APPROVED', ?, ?)`,
      [vendorId, name, now, now],
    );
    const profileId = Number(profileResult.insertId);
    await pool.execute('UPDATE cb_vendor_identity SET active_profile_version_id = ? WHERE id = ?', [
      profileId, vendorId,
    ]);
    const session = await addSession({ vendorId, profileId });
    return { accountId: Number(actor.id), vendorId, profileId, ...session };
  }

  /** 新增营业轮次并切换摊主当前指针；调用前必须先结束上一轮（活跃轮次唯一）。 */
  async function addSession({ vendorId, profileId, startedOffsetMin = 10, plannedOffsetMin = 110 }) {
    const pool = getPool();
    const now = Date.now();
    const [sessionResult] = await pool.execute(
      `INSERT INTO cb_vendor_session
         (vendor_id, profile_version_id, started_at_ms, planned_end_at_ms, ended_at_ms, end_reason, version)
       VALUES (?, ?, ?, ?, NULL, NULL, 1)`,
      [vendorId, profileId, now - startedOffsetMin * MINUTE, now + plannedOffsetMin * MINUTE],
    );
    const sessionId = Number(sessionResult.insertId);
    const [locationResult] = await pool.execute(
      `INSERT INTO cb_session_location
         (session_id, vendor_id, version_no, lat, lng, location_name, located_at_ms, effective_at_ms)
       VALUES (?, ?, 1, ?, ?, '人民广场', ?, ?)`,
      [sessionId, vendorId, ORIGIN.lat, ORIGIN.lng, now, now],
    );
    await pool.execute('UPDATE cb_vendor_identity SET current_session_id = ? WHERE id = ?', [sessionId, vendorId]);
    return { sessionId, locationId: Number(locationResult.insertId), profileId };
  }

  async function endSession({ vendorId, sessionId }) {
    const pool = getPool();
    await pool.execute(
      `UPDATE cb_vendor_session SET ended_at_ms = ?, end_reason = 'MANUAL', version = version + 1 WHERE id = ?`,
      [Date.now(), sessionId],
    );
    await pool.execute('UPDATE cb_vendor_identity SET current_session_id = NULL WHERE id = ?', [vendorId]);
  }

  /** 反馈夹具沿用 W5/W6 的写入顺序：观察先落库，再由观察换取定位上下文并提交。 */
  async function submitFeedback({ reporterOpenid, vendor, sessionId, locationId, type = 'OWNER_ABSENT' }) {
    const reporter = await account.resolveAccount(identity(reporterOpenid));
    const pool = getPool();
    const eventAtMs = Date.now();
    const [observationResult] = await pool.execute(
      `INSERT INTO cb_feedback_observation
         (viewer_account_id, claim_token_hash, vendor_id, session_id, location_version_id,
          event_at_ms, source, event_public_status, version, state_version)
       VALUES (?, NULL, ?, ?, ?, ?, 'DETAIL', 'OPEN', 1, 1)`,
      [reporter.id, vendor.vendorId, sessionId, locationId, eventAtMs],
    );
    const observationId = Number(observationResult.insertId);
    const context = await httpRequest('/me/location-contexts', {
      method: 'POST', openid: reporterOpenid, key: `w7-ctx-${observationId}`,
      body: { purpose: 'FEEDBACK', targetId: String(observationId) },
    });
    assert.equal(context.status, 200, '定位上下文签发失败');
    const submitted = await httpRequest('/me/field-feedback', {
      method: 'POST', openid: reporterOpenid, key: `w7-fb-${observationId}`,
      body: {
        observationId: String(observationId),
        type,
        description: '到现场没看到摊主',
        locationContextToken: context.body.data.locationContextToken,
        location: { lat: NEAR.lat, lng: NEAR.lng, locatedAtMs: await dbNowMs(pool) },
        expectedObservationVersion: 1,
      },
    });
    assert.equal(submitted.status, 200, `反馈提交失败：${JSON.stringify(submitted.body)}`);
    return { ...submitted.body.data, observationId };
  }

  async function cleanupFixtures() {
    const pool = getPool();
    const [accounts] = await pool.execute("SELECT id FROM cb_user_account WHERE wx_openid LIKE 'w7-it-%'");
    for (const { id } of accounts) {
      const [vendors] = await pool.execute('SELECT id FROM cb_vendor_identity WHERE account_id = ?', [id]);
      for (const { id: vendorId } of vendors) {
        await pool.execute(
          'DELETE FROM cb_feedback_fact_decision WHERE review_id IN '
          + '(SELECT id FROM cb_feedback_review_event WHERE case_id IN '
          + '(SELECT id FROM cb_feedback_case WHERE vendor_id = ?))', [vendorId],
        );
        await pool.execute(
          'DELETE FROM cb_feedback_review_event WHERE case_id IN '
          + '(SELECT id FROM cb_feedback_case WHERE vendor_id = ?)', [vendorId],
        );
        await pool.execute(
          'DELETE FROM cb_feedback_fact WHERE case_id IN '
          + '(SELECT id FROM cb_feedback_case WHERE vendor_id = ?)', [vendorId],
        );
        await pool.execute('DELETE FROM cb_feedback_case WHERE vendor_id = ?', [vendorId]);
        await pool.execute(
          'DELETE FROM cb_navigation_check WHERE observation_id IN '
          + '(SELECT id FROM cb_feedback_observation WHERE vendor_id = ?)', [vendorId],
        );
        await pool.execute('DELETE FROM cb_feedback_observation WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_management_action WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_impact_record WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_session_location WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_session WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_open_day WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_publication_control WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_profile_version WHERE vendor_id = ?', [vendorId]);
      }
      await pool.execute('DELETE FROM cb_location_context WHERE account_id = ?', [id]);
      await pool.execute('DELETE FROM cb_idempotency_operation WHERE actor_scope = ?', [`account:${id}`]);
      await pool.execute('DELETE FROM cb_audit_event WHERE actor_account_id = ?', [id]);
      await pool.execute('DELETE FROM cb_admin_permission_grant WHERE account_id = ?', [id]);
      await pool.execute('DELETE FROM cb_user_role WHERE account_id = ?', [id]);
      await pool.execute('DELETE FROM cb_vendor_identity WHERE account_id = ?', [id]);
      await pool.execute('DELETE FROM cb_user_account WHERE id = ?', [id]);
    }
  }

  before(async () => {
    const result = await runPhase1Migrations(getPool());
    assert.ok(result.applied.length > 0 || result.skipped.length > 0);
    await cleanupFixtures();
    server = useNamedPipe ? app.listen(namedPipePath) : app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    await signIn('w7-it-reviewer');
    await signIn('w7-it-admin');
    await signIn('w7-it-nobody');
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await cleanupFixtures();
    await closeDatabase();
  });

  test('越权：无身份 401、无角色 403、审核员不能治理、管理员不能复核反馈', async () => {
    assert.equal((await httpRequest('/management/context')).status, 401);
    assert.equal((await httpRequest('/management/context', { openid: 'w7-it-nobody' })).status, 403);
    const reviewer = await httpRequest('/management/vendors', { openid: 'w7-it-reviewer' });
    assert.equal(reviewer.status, 403);
    assert.equal(reviewer.body.bizCode, 'PERMISSION_DENIED');
    const admin = await httpRequest('/management/field-feedback', { openid: 'w7-it-admin' });
    assert.equal(admin.status, 403);
    assert.equal(admin.body.bizCode, 'PERMISSION_DENIED');
  });

  test('管理上下文：返回角色、能力与待办计数', async () => {
    const context = await httpRequest('/management/context', { openid: 'w7-it-reviewer' });
    assert.equal(context.status, 200);
    assert.deepEqual(context.body.data.capabilities, ['FIELD_REVIEWER']);
    assert.ok(Number.isInteger(context.body.data.queueCounts.fieldFeedback));
    assert.ok(Number.isInteger(context.body.data.queueCounts.profileReviews));
    const adminContext = await httpRequest('/management/context', { openid: 'w7-it-admin' });
    assert.deepEqual(adminContext.body.data.roles, ['ADMIN']);
  });

  test('复核：跨轮次事实逐条可追溯，详情读取留受限审计', async () => {
    const vendor = await createVendor('w7-it-vendor-a');
    const first = await submitFeedback({
      reporterOpenid: 'w7-it-reporter', vendor, sessionId: vendor.sessionId, locationId: vendor.locationId,
    });
    await endSession({ vendorId: vendor.vendorId, sessionId: vendor.sessionId });
    const second = await addSession({ vendorId: vendor.vendorId, profileId: vendor.profileId });
    const merged = await submitFeedback({
      reporterOpenid: 'w7-it-reporter',
      vendor,
      sessionId: second.sessionId,
      locationId: second.locationId,
    });
    assert.equal(merged.caseId, first.caseId, '同人同摊主同事件日同类型必须落在同一事项');

    const list = await httpRequest('/management/field-feedback?status=PENDING&limit=50', {
      openid: 'w7-it-reviewer',
    });
    assert.equal(list.status, 200);
    const summary = list.body.data.rows.find((row) => row.caseId === first.caseId);
    assert.ok(summary, '新事项必须出现在待审列表');
    assert.equal(summary.factCount, 2);
    assert.equal(summary.reporterCount, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(summary, 'reporterLat'), false);

    const detail = await httpRequest(`/management/field-feedback/${first.caseId}`, {
      openid: 'w7-it-reviewer',
    });
    assert.equal(detail.status, 200);
    const data = detail.body.data;
    assert.equal(data.facts.length, 2);
    assert.equal(data.currentSessionId, String(second.sessionId));
    const bySession = new Map(data.facts.map((fact) => [fact.session.sessionId, fact]));
    assert.equal(bySession.get(String(vendor.sessionId)).session.isCurrent, false);
    assert.equal(bySession.get(String(second.sessionId)).session.isCurrent, true);
    assert.notEqual(
      bySession.get(String(vendor.sessionId)).locationVersion.locationVersionId,
      bySession.get(String(second.sessionId)).locationVersion.locationVersionId,
    );
    assert.ok(bySession.get(String(second.sessionId)).evidence.distanceM >= 0);

    const pool = getPool();
    const [audits] = await pool.execute(
      `SELECT action_code, retention_class FROM cb_audit_event
       WHERE target_type = 'FEEDBACK_CASE' AND target_id = ?`, [first.caseId],
    );
    assert.ok(audits.some((row) => row.action_code === 'MANAGEMENT_FEEDBACK_VIEWED'));
    assert.equal(audits.find((row) => row.action_code === 'MANAGEMENT_FEEDBACK_VIEWED').retention_class, 'MANAGEMENT');
    fixture = { vendor, first, second, detail: data };
  });

  test('决定：漏判拒绝、旧版本冲突、确认成立后生成影响记录且不结束当前轮次', async () => {
    const { vendor, first, detail } = fixture;
    const facts = detail.facts;
    const oneFact = await httpRequest(`/management/field-feedback/${first.caseId}/decision`, {
      method: 'POST', openid: 'w7-it-reviewer', key: 'w7-dec-incomplete',
      body: {
        factResults: [{ factId: facts[0].factId, result: 'CONFIRM', reasonCode: 'ON_SITE_CONFIRMED' }],
        expectedTaskVersion: detail.taskVersion,
      },
    });
    assert.equal(oneFact.status, 400);
    assert.equal(oneFact.body.data.fields[0].reason, 'FACT_SET_MISMATCH');

    const stale = await httpRequest(`/management/field-feedback/${first.caseId}/decision`, {
      method: 'POST', openid: 'w7-it-reviewer', key: 'w7-dec-stale',
      body: {
        factResults: facts.map((fact) => ({
          factId: fact.factId, result: 'CONFIRM', reasonCode: 'ON_SITE_CONFIRMED',
        })),
        expectedTaskVersion: detail.taskVersion + 5,
      },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.bizCode, 'STATE_CONFLICT');

    const decided = await httpRequest(`/management/field-feedback/${first.caseId}/decision`, {
      method: 'POST', openid: 'w7-it-reviewer', key: 'w7-dec-ok',
      body: {
        factResults: [
          { factId: facts[0].factId, result: 'CONFIRM', reasonCode: 'ON_SITE_CONFIRMED' },
          { factId: facts[1].factId, result: 'NOT_CONFIRM', reasonCode: 'INSUFFICIENT_EVIDENCE', reasonText: '第二次未发现异常' },
        ],
        expectedTaskVersion: detail.taskVersion,
      },
    });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.data.status, 'CONFIRMED');
    assert.deepEqual(decided.body.data.confirmedFactIds, [facts[0].factId]);
    assert.ok(decided.body.data.impactRecordId);

    const pool = getPool();
    const [sessions] = await pool.execute(
      'SELECT ended_at_ms FROM cb_vendor_session WHERE id = ?', [fixture.second.sessionId],
    );
    assert.equal(sessions[0].ended_at_ms, null, '反馈结案不得自动结束当前轮次');

    const [decisions] = await pool.execute(
      `SELECT d.result, d.reason_code, d.reason_text FROM cb_feedback_fact_decision d
       JOIN cb_feedback_review_event r ON r.id = d.review_id WHERE r.case_id = ? ORDER BY d.fact_id`,
      [first.caseId],
    );
    assert.equal(decisions.length, 2);
    assert.ok(decisions.some((row) => row.reason_code === 'INSUFFICIENT_EVIDENCE' && row.reason_text));
  });

  test('决定：全部不确认时事项不成立且不生成影响记录，重复决定拒绝', async () => {
    const vendor = await createVendor('w7-it-vendor-b', '阿May手打柠檬茶');
    const feedback = await submitFeedback({
      reporterOpenid: 'w7-it-reporter', vendor,
      sessionId: vendor.sessionId, locationId: vendor.locationId, type: 'ALREADY_LEFT',
    });
    const detail = await httpRequest(`/management/field-feedback/${feedback.caseId}`, { openid: 'w7-it-reviewer' });
    const decided = await httpRequest(`/management/field-feedback/${feedback.caseId}/decision`, {
      method: 'POST', openid: 'w7-it-reviewer', key: 'w7-dec-noconfirm',
      body: {
        factResults: [{
          factId: detail.body.data.facts[0].factId, result: 'NOT_CONFIRM', reasonCode: 'NO_ANOMALY_PROVEN',
        }],
        expectedTaskVersion: detail.body.data.taskVersion,
      },
    });
    assert.equal(decided.status, 200);
    assert.equal(decided.body.data.status, 'NOT_CONFIRMED');
    assert.equal(Object.prototype.hasOwnProperty.call(decided.body.data, 'impactRecordId'), false);

    const again = await httpRequest(`/management/field-feedback/${feedback.caseId}/decision`, {
      method: 'POST', openid: 'w7-it-reviewer', key: 'w7-dec-again',
      body: {
        factResults: [{
          factId: detail.body.data.facts[0].factId, result: 'NOT_CONFIRM', reasonCode: 'NO_ANOMALY_PROVEN',
        }],
        expectedTaskVersion: detail.body.data.taskVersion,
      },
    });
    assert.equal(again.status, 409);
    assert.equal(again.body.bizCode, 'ALREADY_PROCESSED');

    const pool = getPool();
    const [impacts] = await pool.execute(
      "SELECT COUNT(*) AS n FROM cb_vendor_impact_record WHERE vendor_id = ?", [vendor.vendorId],
    );
    assert.equal(Number(impacts[0].n), 0);
  });

  test('纠错：只关指定当前轮次，已结束拒绝，事项与轮次无关时拒绝', async () => {
    const { vendor, first, second } = fixture;
    const corrected = await httpRequest(`/management/sessions/${second.sessionId}/corrections`, {
      method: 'POST', openid: 'w7-it-reviewer', key: 'w7-corr-ok',
      body: {
        sourceCaseId: first.caseId, action: 'CLOSE_CURRENT',
        reason: '现场核实无人', expectedSessionVersion: 1,
      },
    });
    assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
    assert.equal(corrected.body.data.endReason, 'CORRECTION');
    assert.ok(corrected.body.data.actionId);

    const repeated = await httpRequest(`/management/sessions/${second.sessionId}/corrections`, {
      method: 'POST', openid: 'w7-it-reviewer', key: 'w7-corr-again',
      body: {
        sourceCaseId: first.caseId, action: 'CLOSE_CURRENT',
        reason: '再次核对', expectedSessionVersion: 2,
      },
    });
    assert.equal(repeated.status, 409);
    assert.equal(repeated.body.bizCode, 'ALREADY_PROCESSED');

    // 同日新开轮次：旧事项只关联过前两轮，不能据此关闭新轮。
    const unrelated = await addSession({ vendorId: vendor.vendorId, profileId: vendor.profileId });
    const reject = await httpRequest(`/management/sessions/${unrelated.sessionId}/corrections`, {
      method: 'POST', openid: 'w7-it-reviewer', key: 'w7-corr-unrelated',
      body: {
        sourceCaseId: first.caseId, action: 'CLOSE_CURRENT',
        reason: '事项只关联旧轮次', expectedSessionVersion: 1,
      },
    });
    assert.equal(reject.status, 400);
    assert.equal(reject.body.data.fields[0].reason, 'SESSION_NOT_RELATED');

    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT ended_at_ms, end_reason FROM cb_vendor_session WHERE id = ?', [unrelated.sessionId],
    );
    assert.equal(rows[0].ended_at_ms, null, '被拒绝的纠错不得结束任何轮次');
    const [actions] = await pool.execute(
      "SELECT target_session_id, source_case_id FROM cb_management_action WHERE action_type = 'SESSION_CORRECTION' AND vendor_id = ?",
      [vendor.vendorId],
    );
    assert.equal(actions.length, 1);
    assert.equal(String(actions[0].source_case_id), first.caseId);
  });

  test('治理：暂停结束当前轮次并从公开集合移除，恢复只清治理列', async () => {
    const vendor = await createVendor('w7-it-vendor-c', '深夜关东煮');
    const before = await httpRequest('/public/vendors/search', { method: 'POST', body: {} });
    assert.ok(before.body.data.items.some((item) => item.vendorId === String(vendor.vendorId)),
      '暂停前应在公开集合内');

    const context = await httpRequest(`/management/vendors/${vendor.vendorId}/governance-context`, {
      openid: 'w7-it-admin',
    });
    assert.equal(context.status, 200);
    assert.equal(context.body.data.governanceVersion, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(context.body.data.controls, 'governancePausedAtMs'), false);

    const paused = await httpRequest(`/management/vendors/${vendor.vendorId}/governance-decisions`, {
      method: 'POST', openid: 'w7-it-admin', key: 'w7-gov-pause',
      body: { action: 'PAUSE', reason: '连续两次现场核实不实', expectedGovernanceVersion: 1 },
    });
    assert.equal(paused.status, 200, JSON.stringify(paused.body));
    assert.ok(paused.body.data.governancePausedAtMs);
    assert.equal(paused.body.data.endedSessionId, String(vendor.sessionId));
    assert.ok(paused.body.data.actionId);
    assert.equal(paused.body.data.governanceVersion, 2);

    const afterPause = await httpRequest('/public/vendors/search', { method: 'POST', body: {} });
    assert.equal(afterPause.body.data.items.some((item) => item.vendorId === String(vendor.vendorId)), false,
      '治理暂停后必须立即从公开集合移除');

    const pausedContext = await httpRequest(`/management/vendors/${vendor.vendorId}/governance-context`, {
      openid: 'w7-it-admin',
    });
    assert.equal(pausedContext.body.data.eligibility.eligible, false);
    assert.ok(pausedContext.body.data.eligibility.reasons.includes('GOVERNANCE_PAUSED'));
    assert.ok(pausedContext.body.data.recentActions.some((row) => row.actionType === 'GOVERNANCE_PAUSE'));

    const pool = getPool();
    const [sessions] = await pool.execute(
      'SELECT ended_at_ms, end_reason FROM cb_vendor_session WHERE id = ?', [vendor.sessionId],
    );
    assert.equal(sessions[0].end_reason, 'GOVERNANCE');

    const restored = await httpRequest(`/management/vendors/${vendor.vendorId}/governance-decisions`, {
      method: 'POST', openid: 'w7-it-admin', key: 'w7-gov-restore',
      body: { action: 'RESTORE', reason: '复核后解除', expectedGovernanceVersion: 2 },
    });
    assert.equal(restored.status, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(restored.body.data, 'governancePausedAtMs'), false);
    assert.equal(restored.body.data.governanceVersion, 3);

    const [vendorRow] = await pool.execute(
      'SELECT current_session_id FROM cb_vendor_identity WHERE id = ?', [vendor.vendorId],
    );
    assert.equal(vendorRow[0].current_session_id, null, '恢复公开不得复活旧轮次');
  });

  test('本人影响记录：只含摘要与期限，不含反馈人身份与坐标', async () => {
    const { vendor } = fixture;
    const records = await httpRequest('/me/impact-records?limit=50', { openid: 'w7-it-vendor-a' });
    assert.equal(records.status, 200);
    const sourceTypes = records.body.data.rows.map((row) => row.sourceType);
    assert.ok(sourceTypes.includes('FEEDBACK_CASE'));
    assert.ok(sourceTypes.includes('MANAGEMENT_ACTION'));
    for (const row of records.body.data.rows) {
      assert.equal(Object.prototype.hasOwnProperty.call(row, 'reporterAccountId'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(row, 'reporterLat'), false);
      assert.ok(row.reviewableUntilMs > row.createdAtMs);
    }
    assert.ok(records.body.data.rows.every((row) => !row.summary.includes('w7-it-reporter')));
    assert.ok(vendor.vendorId);
  });
}

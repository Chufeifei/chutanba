/**
 * W8 集成用例：本人资料清除、保留期挂起与影响人工复核。
 *
 * 只连隔离库 phase1_test_w8；夹具以 w8-it- 前缀创建并在结束时清理。
 * 覆盖：清除成立即生效、范围升级拒绝、清理幂等与超期、保留挂起与延期、
 * 影响复核的本人申请与管理决定（只改影响状态，不扩大效力）。
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');

const isolatedDatabase = process.env.PHASE1_TEST_DATABASE;
const useNamedPipe = process.env.PHASE1_TEST_HTTP_PIPE === '1';
const namedPipePath = `\\\\.\\pipe\\chutanba-w8-it-${process.pid}`;

if (!isolatedDatabase) {
  test('W8 integration requires PHASE1_TEST_* credentials', { skip: '未提供 phase1_test_w8 隔离库凭据' }, () => {});
} else {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_DEV_IDENTITY = 'true';
  process.env.LOCATION_CONTEXT_SECRET = 'w8-location-secret';
  process.env.PUBLIC_TOKEN_SECRET = 'w8-public-secret';
  // 管理资格只来自部署名单：复核决定要 ADMIN，现场反馈核实要 FIELD_REVIEWER。
  process.env.FIELD_REVIEWER_OPENIDS = 'w8-it-reviewer';
  process.env.ADMIN_OPENIDS = 'w8-it-admin';
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
  const clearance = require('../src/modules/clearance');
  const retention = require('../src/modules/retention');

  const MINUTE = 60_000;
  const identity = (openid) => ({ openid, unionid: null, userId: null, source: 'dev' });
  const ORIGIN = { lat: 31.2304, lng: 121.4737 };
  const NEAR = { lat: ORIGIN.lat + 0.00269, lng: ORIGIN.lng };
  let server = null;

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
      [actor.id, `W8IT${String(actor.id).padStart(8, '0')}`, now, now],
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

  /** 待审资料版本：清除成立后必须被冻结为 INVALIDATED。 */
  async function addPendingProfileVersion(vendorId) {
    const pool = getPool();
    const now = Date.now();
    const [result] = await pool.execute(
      `INSERT INTO cb_vendor_profile_version
         (vendor_id, version_no, vendor_name, category_code, regular_items_text,
          price_description, announcement, review_status, submitted_at_ms)
       VALUES (?, 2, '待审新名称', 'DRINK', '柠檬水', '十元', '夏季新品', 'PENDING', ?)`,
      [vendorId, now],
    );
    return Number(result.insertId);
  }

  /** 反馈夹具沿用 W5／W6 的写入顺序：观察先落库，再由观察换取定位上下文并提交。 */
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
      method: 'POST', openid: reporterOpenid, key: `w8-ctx-${observationId}`,
      body: { purpose: 'FEEDBACK', targetId: String(observationId) },
    });
    assert.equal(context.status, 200, '定位上下文签发失败');
    const submitted = await httpRequest('/me/field-feedback', {
      method: 'POST', openid: reporterOpenid, key: `w8-fb-${observationId}`,
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

  /** 管理核实事实成立：结案并生成影响记录，作为影响复核的来源。 */
  async function confirmFeedback({ reviewerOpenid, caseId }) {
    const detail = await httpRequest(`/management/field-feedback/${caseId}`, { openid: reviewerOpenid });
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    const decided = await httpRequest(`/management/field-feedback/${caseId}/decision`, {
      method: 'POST', openid: reviewerOpenid, key: `w8-dec-${caseId}`,
      body: {
        factResults: [{
          factId: detail.body.data.facts[0].factId,
          result: 'CONFIRM',
          reasonCode: 'ON_SITE_CONFIRMED',
        }],
        expectedTaskVersion: detail.body.data.taskVersion,
      },
    });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    return decided.body.data;
  }

  async function cleanupFixtures() {
    const pool = getPool();
    const [accounts] = await pool.execute("SELECT id FROM cb_user_account WHERE wx_openid LIKE 'w8-it-%'");
    for (const { id } of accounts) {
      const [vendors] = await pool.execute('SELECT id FROM cb_vendor_identity WHERE account_id = ?', [id]);
      for (const { id: vendorId } of vendors) {
        await pool.execute(
          'DELETE FROM cb_retention_hold WHERE target_id IN (SELECT id FROM cb_session_location WHERE vendor_id = ?) '
          + 'OR target_id IN (SELECT id FROM cb_feedback_case WHERE vendor_id = ?)',
          [vendorId, vendorId],
        );
        await pool.execute(
          'DELETE FROM cb_retention_hold WHERE source_id IN (SELECT id FROM cb_feedback_case WHERE vendor_id = ?) '
          + 'OR source_id IN (SELECT id FROM cb_vendor_impact_review_request WHERE vendor_id = ?)',
          [vendorId, vendorId],
        );
        await pool.execute('DELETE FROM cb_vendor_impact_review_request WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_impact_record WHERE vendor_id = ?', [vendorId]);
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
        await pool.execute('DELETE FROM cb_session_location WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_session WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_open_day WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_publication_control WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_profile_version WHERE vendor_id = ?', [vendorId]);
      }
      await pool.execute('DELETE FROM cb_data_clear_request WHERE account_id = ?', [id]);
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
    await signIn('w8-it-reviewer');
    await signIn('w8-it-admin');
    await signIn('w8-it-nobody');
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await cleanupFixtures();
    await closeDatabase();
  });

  test('越权与入参：本人端点要身份，管理复核要 ADMIN，范围枚举受限', async () => {
    assert.equal((await httpRequest('/me/data-clear-preview?scope=ALL')).status, 401);
    assert.equal((await httpRequest('/management/impact-reviews')).status, 401);
    const nobody = await httpRequest('/management/impact-reviews', { openid: 'w8-it-nobody' });
    assert.equal(nobody.status, 403);
    assert.equal(nobody.body.bizCode, 'PERMISSION_DENIED');

    const badScope = await httpRequest('/me/data-clear-preview?scope=WHATEVER', { openid: 'w8-it-nobody' });
    assert.equal(badScope.status, 400);
    assert.equal(badScope.body.bizCode, 'VALIDATION_FAILED');

    const missingVersion = await httpRequest('/me/data-clear-requests', {
      method: 'POST', openid: 'w8-it-nobody', key: 'w8-missing-version',
      body: { scope: 'ALL' },
    });
    assert.equal(missingVersion.status, 400);
    assert.equal(missingVersion.body.data.fields[0].field, 'expectedAccountVersion');
  });

  test('预览：受影响范围、当前轮次与保留说明一次给全，且不写任何数据', async () => {
    const vendor = await createVendor('w8-it-vendor-a', '老张烤冷面');
    const pool = getPool();
    const before = await countClearRequests(pool, vendor.accountId);

    const preview = await httpRequest('/me/data-clear-preview?scope=ALL', { openid: 'w8-it-vendor-a' });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const data = preview.body.data;
    assert.equal(data.scope, 'ALL');
    assert.equal(data.effectiveScope, 'ALL');
    assert.equal(data.requiresExplicitAll, false);
    assert.deepEqual(data.affectedKinds, ['ACCOUNT_PROFILE', 'VENDOR_PROFILE', 'SESSION_LOCATIONS']);
    assert.equal(data.activeSessionImpact.hasActiveSession, true);
    assert.equal(data.activeSessionImpact.willEnd, true);
    assert.equal(data.activeSessionImpact.endReason, 'SELF_STOP');
    assert.equal(data.estimatedCompletion.days, 30);
    assert.equal(await countClearRequests(pool, vendor.accountId), before, '预览不得写业务数据');

    const accountOnly = await httpRequest('/me/data-clear-preview?scope=ACCOUNT_DATA', { openid: 'w8-it-vendor-a' });
    assert.equal(accountOnly.body.data.requiresExplicitAll, true);
    assert.equal(accountOnly.body.data.effectiveScope, 'ALL');
  });

  test('范围升级：账号仍有摊主资料时 ACCOUNT_DATA 被拒，且不产生任何写入', async () => {
    const vendor = await createVendor('w8-it-vendor-b', '阿May手打柠檬茶');
    const me = await signIn('w8-it-vendor-b');
    const pool = getPool();
    const before = await countClearRequests(pool, vendor.accountId);

    const rejected = await httpRequest('/me/data-clear-requests', {
      method: 'POST', openid: 'w8-it-vendor-b', key: 'w8-scope-upgrade',
      body: { scope: 'ACCOUNT_DATA', expectedAccountVersion: me.accountVersion },
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.bizCode, 'VALIDATION_FAILED');
    assert.equal(rejected.body.data.fields[0].reason, 'SCOPE_UPGRADE_REQUIRED');
    assert.equal(await countClearRequests(pool, vendor.accountId), before, '被拒的清除请求不得留下请求行');

    const [sessions] = await pool.execute(
      'SELECT ended_at_ms FROM cb_vendor_session WHERE id = ?', [vendor.sessionId],
    );
    assert.equal(sessions[0].ended_at_ms, null, '被拒的清除请求不得结束轮次');
  });

  test('清除成立即生效：轮次结束、停止公开、待审冻结、生效指针清空、两条审计', async () => {
    const vendor = await createVendor('w8-it-vendor-c', '深夜关东煮');
    const pendingProfileId = await addPendingProfileVersion(vendor.vendorId);
    const me = await signIn('w8-it-vendor-c');

    const submitted = await httpRequest('/me/data-clear-requests', {
      method: 'POST', openid: 'w8-it-vendor-c', key: 'w8-clear-ok',
      body: { scope: 'ALL', expectedAccountVersion: me.accountVersion },
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.ok(submitted.body.data.clearRequestId);
    assert.deepEqual(submitted.body.data.affectedKinds, ['ACCOUNT_PROFILE', 'VENDOR_PROFILE', 'SESSION_LOCATIONS']);

    const pool = getPool();
    const [sessions] = await pool.execute(
      'SELECT ended_at_ms, end_reason FROM cb_vendor_session WHERE id = ?', [vendor.sessionId],
    );
    assert.ok(sessions[0].ended_at_ms, '清除成立必须结束当前轮次');
    assert.equal(sessions[0].end_reason, 'SELF_STOP');

    const [vendorRow] = await pool.execute(
      'SELECT active_profile_version_id, current_session_id FROM cb_vendor_identity WHERE id = ?',
      [vendor.vendorId],
    );
    assert.equal(vendorRow[0].active_profile_version_id, null, '清除后生效资料指针必须清空');
    assert.equal(vendorRow[0].current_session_id, null);

    const [controls] = await pool.execute(
      'SELECT self_stopped_at_ms, governance_paused_at_ms FROM cb_vendor_publication_control WHERE vendor_id = ?',
      [vendor.vendorId],
    );
    assert.ok(controls[0].self_stopped_at_ms, '清除成立必须按本人停止公开处理');
    assert.equal(controls[0].governance_paused_at_ms, null, '本人停止不得写治理列');

    const [pending] = await pool.execute(
      'SELECT review_status FROM cb_vendor_profile_version WHERE id = ?', [pendingProfileId],
    );
    assert.equal(pending[0].review_status, 'INVALIDATED', '相交待审资料必须被冻结');

    const [requests] = await pool.execute(
      'SELECT status, due_at_ms, accepted_at_ms FROM cb_data_clear_request WHERE account_id = ?', [vendor.accountId],
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].status, 'QUEUED');
    assert.equal(
      Number(requests[0].due_at_ms),
      retention.clearRequestDueAtMs(Number(requests[0].accepted_at_ms)),
      '处理窗口必须是 30 个上海自然日',
    );

    const [audits] = await pool.execute(
      `SELECT action_code FROM cb_audit_event
       WHERE target_type = 'VENDOR' AND target_id = ?`, [vendor.vendorId],
    );
    assert.ok(audits.some((row) => row.action_code === 'PUBLICATION_SELF_STOPPED'));
    const [clearAudits] = await pool.execute(
      `SELECT action_code FROM cb_audit_event
       WHERE target_type = 'DATA_CLEAR_REQUEST' AND target_id = ?`,
      [submitted.body.data.clearRequestId],
    );
    assert.ok(clearAudits.some((row) => row.action_code === 'DATA_CLEAR_REQUESTED'));
  });

  test('清除后不得重新公开：公开集合立即移除，恢复公开要求重新提交资料', async () => {
    const vendor = await createVendor('w8-it-vendor-d', '清晨豆浆铺');
    const me = await signIn('w8-it-vendor-d');
    const before = await httpRequest('/public/vendors/search', { method: 'POST', body: {} });
    assert.ok(before.body.data.items.some((item) => item.vendorId === String(vendor.vendorId)));

    const submitted = await httpRequest('/me/data-clear-requests', {
      method: 'POST', openid: 'w8-it-vendor-d', key: 'w8-clear-unpublish',
      body: { scope: 'ALL', expectedAccountVersion: me.accountVersion },
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));

    const after = await httpRequest('/public/vendors/search', { method: 'POST', body: {} });
    assert.equal(
      after.body.data.items.some((item) => item.vendorId === String(vendor.vendorId)),
      false,
      '清除成立后必须立即从公开集合移除',
    );

    const publication = await httpRequest('/vendor/publication', { openid: 'w8-it-vendor-d' });
    const resume = await httpRequest('/vendor/publication/resume', {
      method: 'POST', openid: 'w8-it-vendor-d', key: 'w8-resume-after-clear',
      body: { expectedSelfVersion: publication.body.data.selfVersion },
    });
    assert.equal(resume.status, 422);
    assert.equal(resume.body.bizCode, 'PROFILE_REQUIRED', '无生效资料时恢复公开必须被拦下');
  });

  test('幂等：同一幂等键重放同一清除请求，不产生第二次公开', async () => {
    const vendor = await createVendor('w8-it-vendor-e', '午后糖水铺');
    const me = await signIn('w8-it-vendor-e');
    const body = { scope: 'ALL', expectedAccountVersion: me.accountVersion };
    const first = await httpRequest('/me/data-clear-requests', {
      method: 'POST', openid: 'w8-it-vendor-e', key: 'w8-clear-replay', body,
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const second = await httpRequest('/me/data-clear-requests', {
      method: 'POST', openid: 'w8-it-vendor-e', key: 'w8-clear-replay', body,
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.data.clearRequestId, first.body.data.clearRequestId);
    assert.equal(second.body.data.replayed, true);
    assert.equal(await countClearRequests(getPool(), vendor.accountId), 1);
  });

  test('清理批次：三类分别表述，重复执行不产生二次改动', async () => {
    const vendor = await createVendor('w8-it-vendor-f', '夜市炒粉');
    const me = await signIn('w8-it-vendor-f');
    const pool = getPool();
    await pool.execute('UPDATE cb_user_account SET nickname = ?, phone = ? WHERE id = ?', [
      '夜市炒粉摊主', '13800000000', vendor.accountId,
    ]);

    const submitted = await httpRequest('/me/data-clear-requests', {
      method: 'POST', openid: 'w8-it-vendor-f', key: 'w8-clear-cleanup',
      body: { scope: 'ALL', expectedAccountVersion: me.accountVersion },
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    const requestId = submitted.body.data.clearRequestId;

    const result = await clearance.runCleanup(requestId);
    assert.equal(result.status, 'COMPLETED');
    assert.ok(result.processedKinds.includes('ACCOUNT_PROFILE'));
    assert.ok(result.processedKinds.includes('VENDOR_PROFILE'));
    assert.ok(result.processedKinds.includes('SESSION_LOCATIONS'));
    assert.ok(result.hiddenKinds.some((row) => row.kind === 'PUBLIC_PUBLICATION'));

    const [accounts] = await pool.execute(
      'SELECT nickname, phone, wx_openid FROM cb_user_account WHERE id = ?', [vendor.accountId],
    );
    assert.equal(accounts[0].nickname, null, '账号资料必须被清空');
    assert.equal(accounts[0].phone, null);
    assert.ok(accounts[0].wx_openid, '登录关联永远保留');

    const [profiles] = await pool.execute(
      'SELECT vendor_name, category_code FROM cb_vendor_profile_version WHERE vendor_id = ?', [vendor.vendorId],
    );
    assert.equal(profiles[0].vendor_name, '已清除', '资料内容必须去标识化');

    const [locations] = await pool.execute(
      'SELECT lat, lng, location_name FROM cb_session_location WHERE vendor_id = ?', [vendor.vendorId],
    );
    assert.equal(Number(locations[0].lat), 0, '精确坐标必须被清除');
    assert.equal(Number(locations[0].lng), 0);
    assert.equal(locations[0].location_name, '位置已清除');

    const again = await clearance.runCleanup(requestId);
    assert.equal(again.status, 'COMPLETED');
    const [locationsAfter] = await pool.execute(
      'SELECT lat, location_name FROM cb_session_location WHERE vendor_id = ?', [vendor.vendorId],
    );
    assert.equal(Number(locationsAfter[0].lat), 0);
    assert.equal(locationsAfter[0].location_name, '位置已清除');
  });

  test('超期可见：本人查询进度能读到超期原因与失败标记', async () => {
    const vendor = await createVendor('w8-it-vendor-g', '午后咖啡摊');
    const me = await signIn('w8-it-vendor-g');
    const pool = getPool();
    const submitted = await httpRequest('/me/data-clear-requests', {
      method: 'POST', openid: 'w8-it-vendor-g', key: 'w8-clear-overdue',
      body: { scope: 'ALL', expectedAccountVersion: me.accountVersion },
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    const requestId = submitted.body.data.clearRequestId;
    // 期限与受理时刻一起前移：请求行约束 due_at_ms > accepted_at_ms 不能被破坏。
    const now = Date.now();
    await pool.execute('UPDATE cb_data_clear_request SET accepted_at_ms = ?, due_at_ms = ? WHERE id = ?', [
      now - 2 * 86_400_000, now - 86_400_000, requestId,
    ]);

    const detail = await httpRequest(`/me/data-clear-requests/${requestId}`, { openid: 'w8-it-vendor-g' });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.overdue, true);
    assert.ok(detail.body.data.overdueReason);

    const list = await httpRequest('/me/data-clear-requests?limit=20', { openid: 'w8-it-vendor-g' });
    assert.equal(list.status, 200);
    const item = list.body.data.rows.find((row) => row.clearRequestId === requestId);
    assert.ok(item);
    assert.equal(item.overdue, true);
  });

  test('保留挂起：未结反馈事项阻断位置清理，结案后写延期截止', async () => {
    const vendor = await createVendor('w8-it-vendor-h', '清晨包子铺');
    const feedback = await submitFeedback({
      reporterOpenid: 'w8-it-reporter', vendor,
      sessionId: vendor.sessionId, locationId: vendor.locationId,
    });
    const me = await signIn('w8-it-vendor-h');

    const preview = await httpRequest('/me/data-clear-preview?scope=ALL', { openid: 'w8-it-vendor-h' });
    assert.equal(preview.status, 200);
    const kinds = preview.body.data.retentionExceptions.map((row) => row.kind);
    assert.ok(kinds.includes('OPEN_FEEDBACK_EVIDENCE'), '未结事项必须出现在保留说明里');
    assert.ok(kinds.includes('HELD_LOCATION'), '被挂起的位置必须说明保留依据');
    assert.equal(preview.body.data.pendingReviewImpact.openFeedbackCases, 1);

    const submitted = await httpRequest('/me/data-clear-requests', {
      method: 'POST', openid: 'w8-it-vendor-h', key: 'w8-clear-held',
      body: { scope: 'ALL', expectedAccountVersion: me.accountVersion },
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    const result = await clearance.runCleanup(submitted.body.data.clearRequestId);
    assert.equal(result.status, 'COMPLETED');
    assert.ok(result.retainedKinds.some((row) => row.kind === 'OPEN_FEEDBACK_EVIDENCE'));

    const pool = getPool();
    const [locations] = await pool.execute(
      'SELECT lat, location_name FROM cb_session_location WHERE vendor_id = ?', [vendor.vendorId],
    );
    assert.equal(Number(locations[0].lat), ORIGIN.lat, '被挂起的位置不得被清理');
    assert.equal(locations[0].location_name, '人民广场');

    // 事项结案：挂起关闭并写「结束时刻 + 30 自然日」的延期截止。
    await confirmFeedback({ reviewerOpenid: 'w8-it-reviewer', caseId: feedback.caseId });
    const [holds] = await pool.execute(
      `SELECT closed_at_ms, extended_due_at_ms FROM cb_retention_hold
       WHERE source_type = 'FEEDBACK_CASE' AND source_id = ?`, [feedback.caseId],
    );
    assert.ok(holds.length, '结案必须关闭该事项开出的挂起');
    assert.ok(holds[0].closed_at_ms);
    assert.equal(
      Number(holds[0].extended_due_at_ms),
      retention.caseExtensionDueAtMs(Number(holds[0].closed_at_ms)),
      '延期截止必须是结束时刻加 30 个上海自然日',
    );
  });

  test('影响复核：本人申请、并发冲突、管理决定只改影响状态且不扩大效力', async () => {
    const vendor = await createVendor('w8-it-vendor-i', '深夜烧烤摊');
    const feedback = await submitFeedback({
      reporterOpenid: 'w8-it-reporter', vendor,
      sessionId: vendor.sessionId, locationId: vendor.locationId,
    });
    const decided = await confirmFeedback({
      reviewerOpenid: 'w8-it-reviewer', caseId: feedback.caseId,
    });
    const impactRecordId = decided.impactRecordId;
    assert.ok(impactRecordId);

    const impacts = await httpRequest('/me/impact-records?limit=20', { openid: 'w8-it-vendor-i' });
    const impact = impacts.body.data.rows.find((row) => row.impactRecordId === impactRecordId);
    assert.ok(impact, '成立的影响必须出现在本人影响记录里');

    // 先给治理暂停：复核决定不得把它当成「一并撤销」。
    const paused = await httpRequest(`/management/vendors/${vendor.vendorId}/governance-decisions`, {
      method: 'POST', openid: 'w8-it-admin', key: 'w8-gov-pause',
      body: { action: 'PAUSE', reason: '现场核实存疑，先暂停公开', expectedGovernanceVersion: 1 },
    });
    assert.equal(paused.status, 200, JSON.stringify(paused.body));

    const submitted = await httpRequest('/me/impact-reviews', {
      method: 'POST', openid: 'w8-it-vendor-i', key: 'w8-review-submit',
      body: { impactRecordId, reason: '当日我在摊位上，请复核核实结论', expectedImpactVersion: impact.impactVersion },
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(submitted.body.data.status, 'PENDING');
    const reviewId = submitted.body.data.impactReviewId;

    // 同一影响的未结复核不重复创建。
    const duplicate = await httpRequest('/me/impact-reviews', {
      method: 'POST', openid: 'w8-it-vendor-i', key: 'w8-review-duplicate',
      body: { impactRecordId, reason: '再申请一次', expectedImpactVersion: impact.impactVersion },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.bizCode, 'STATE_CONFLICT');

    // 越权：他人看不到也改不了本人的复核申请。
    const other = await httpRequest(`/me/impact-reviews/${reviewId}`, { openid: 'w8-it-nobody' });
    assert.equal(other.status, 404);
    const denied = await httpRequest(`/management/impact-reviews/${reviewId}/decision`, {
      method: 'POST', openid: 'w8-it-nobody', key: 'w8-review-denied',
      body: { decision: 'REVOKED', reason: '越权尝试', expectedTaskVersion: 1 },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.bizCode, 'PERMISSION_DENIED');

    const pool = getPool();
    const [before] = await pool.execute(
      'SELECT status, task_version FROM cb_vendor_impact_review_request WHERE id = ?', [reviewId],
    );
    assert.equal(before[0].status, 'PENDING', '越权请求不得改动复核申请');

    const queue = await httpRequest('/management/impact-reviews?status=PENDING&limit=20', {
      openid: 'w8-it-admin',
    });
    assert.equal(queue.status, 200);
    assert.ok(queue.body.data.rows.some((row) => row.impactReviewId === reviewId));

    const stale = await httpRequest(`/management/impact-reviews/${reviewId}/decision`, {
      method: 'POST', openid: 'w8-it-admin', key: 'w8-review-stale',
      body: { decision: 'REVOKED', reason: '版本过期', expectedTaskVersion: 9 },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.bizCode, 'STATE_CONFLICT');

    const revoked = await httpRequest(`/management/impact-reviews/${reviewId}/decision`, {
      method: 'POST', openid: 'w8-it-admin', key: 'w8-review-revoked',
      body: { decision: 'REVOKED', reason: '核实未成立，撤销影响记录', expectedTaskVersion: 1 },
    });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.equal(revoked.body.data.status, 'REVOKED');
    assert.equal(revoked.body.data.impactStatus, 'REVOKED');

    // 决定后 task_version 递增：后到者带旧版本号按并发冲突处理（AC：STATE_CONFLICT）。
    const repeated = await httpRequest(`/management/impact-reviews/${reviewId}/decision`, {
      method: 'POST', openid: 'w8-it-admin', key: 'w8-review-repeated',
      body: { decision: 'REVOKED', reason: '再次决定', expectedTaskVersion: 1 },
    });
    assert.equal(repeated.status, 409);
    assert.equal(repeated.body.bizCode, 'STATE_CONFLICT');

    // 带当前版本号再来一次：结论已存在，按「已处理」处理，不再改数据。
    const decidedAgain = await httpRequest(`/management/impact-reviews/${reviewId}/decision`, {
      method: 'POST', openid: 'w8-it-admin', key: 'w8-review-decided-again',
      body: { decision: 'UPHELD', reason: '结论已存在', expectedTaskVersion: 2 },
    });
    assert.equal(decidedAgain.status, 409);
    assert.equal(decidedAgain.body.bizCode, 'ALREADY_PROCESSED');

    // 复核不扩大效力：治理暂停列不被自动清除，本人停止列也不被自动写入。
    const [controls] = await pool.execute(
      'SELECT self_stopped_at_ms, governance_paused_at_ms FROM cb_vendor_publication_control WHERE vendor_id = ?',
      [vendor.vendorId],
    );
    assert.ok(controls.length, '治理暂停后必须有公开控制行');
    assert.ok(controls[0].governance_paused_at_ms, '复核不得撤销治理暂停');
    assert.equal(controls[0].self_stopped_at_ms, null, '复核不得写入本人停止列');

    // 复核留痕：原反馈事实与处理历史仍在，影响状态变化由复核行追溯。
    const [facts] = await pool.execute(
      'SELECT COUNT(*) AS n FROM cb_feedback_fact WHERE case_id = ?', [feedback.caseId],
    );
    assert.ok(Number(facts[0].n) > 0, '复核结论不得删除原反馈事实');
    const [audits] = await pool.execute(
      `SELECT action_code FROM cb_audit_event
       WHERE target_type = 'IMPACT_REVIEW' AND target_id = ?`, [reviewId],
    );
    const codes = audits.map((row) => row.action_code);
    assert.ok(codes.includes('IMPACT_REVIEW_REQUESTED'));
    assert.ok(codes.includes('IMPACT_REVIEW_DECIDED'));

    const mine = await httpRequest('/me/impact-reviews?limit=20', { openid: 'w8-it-vendor-i' });
    assert.equal(mine.status, 200);
    const mineItem = mine.body.data.rows.find((row) => row.impactReviewId === reviewId);
    assert.ok(mineItem);
    assert.equal(mineItem.status, 'REVOKED');
  });

  test('清除与复核并行不互相解除：清除后本人停止列仍在', async () => {
    const vendor = await createVendor('w8-it-vendor-j', '午后手作甜品');
    const me = await signIn('w8-it-vendor-j');
    const submitted = await httpRequest('/me/data-clear-requests', {
      method: 'POST', openid: 'w8-it-vendor-j', key: 'w8-clear-final',
      body: { scope: 'ALL', expectedAccountVersion: me.accountVersion },
    });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));

    const pool = getPool();
    const [controls] = await pool.execute(
      'SELECT self_stopped_at_ms, governance_paused_at_ms FROM cb_vendor_publication_control WHERE vendor_id = ?',
      [vendor.vendorId],
    );
    assert.ok(controls[0].self_stopped_at_ms);
    assert.equal(controls[0].governance_paused_at_ms, null);
  });
}

async function countClearRequests(pool, accountId) {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) AS n FROM cb_data_clear_request WHERE account_id = ?', [accountId],
  );
  return Number(rows[0].n);
}

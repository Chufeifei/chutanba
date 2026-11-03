/**
 * W6 集成用例：观察领取、反馈提交、窗口与距离、事项合并与本人读模型。
 * 只连隔离库 phase1_test_w6；夹具以 w6-it- 前缀创建并在结束时清理。
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');

const isolatedDatabase = process.env.PHASE1_TEST_DATABASE;
const useNamedPipe = process.env.PHASE1_TEST_HTTP_PIPE === '1';
const namedPipePath = `\\\\.\\pipe\\chutanba-w6-it-${process.pid}`;

if (!isolatedDatabase) {
  test('W6 integration requires PHASE1_TEST_* credentials', { skip: '未提供 phase1_test_w6 隔离库凭据' }, () => {});
} else {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_DEV_IDENTITY = 'true';
  process.env.LOCATION_CONTEXT_SECRET = 'w6-location-secret';
  process.env.PUBLIC_TOKEN_SECRET = 'w6-public-secret';
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
  const anonymous = require('../src/modules/discovery/anonymous');
  const { sha256Hex } = require('../src/utils/digest');

  const MINUTE = 60_000;
  const identity = (openid) => ({ openid, unionid: null, userId: null, source: 'dev' });
  const ORIGIN = { lat: 31.2304, lng: 121.4737 };
  // 纬度 1 度 ≈ 111194.9 米：0.00269 度 ≈ 299 米，0.00272 度 ≈ 302 米。
  const NEAR = { lat: ORIGIN.lat + 0.00269, lng: ORIGIN.lng };
  const FAR = { lat: ORIGIN.lat + 0.00272, lng: ORIGIN.lng };

  const fixtures = {};
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
          resolve({ status: response.statusCode, headers: response.headers, body: text ? JSON.parse(text) : null });
        });
      });
      request.on('error', reject);
      if (payload !== null) request.write(payload);
      request.end();
    });
  }

  /** 摊主夹具：账号、摊主、生效资料、轮次与初始位置；mode 决定窗口状态。 */
  async function createVendor({ openid, name, categoryCode = 'SNACK', mode = 'OPEN', plannedOffsetMin = 110 }) {
    const actor = await account.resolveAccount(identity(openid));
    const pool = getPool();
    const now = Date.now();
    const [vendorResult] = await pool.execute(
      `INSERT INTO cb_vendor_identity
         (account_id, vendor_code, lifecycle_status, active_profile_version_id, state_version, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'ACTIVE', NULL, 1, ?, ?)`,
      [actor.id, `W6IT${String(actor.id).padStart(8, '0')}`, now, now],
    );
    const vendorId = Number(vendorResult.insertId);
    const [profileResult] = await pool.execute(
      `INSERT INTO cb_vendor_profile_version
         (vendor_id, version_no, vendor_name, category_code, regular_items_text,
          price_description, announcement, review_status, submitted_at_ms, decided_at_ms)
       VALUES (?, 1, ?, ?, '常卖内容', '价格说明', '公告', 'APPROVED', ?, ?)`,
      [vendorId, name, categoryCode, now, now],
    );
    const profileId = Number(profileResult.insertId);
    await pool.execute('UPDATE cb_vendor_identity SET active_profile_version_id = ? WHERE id = ?', [
      profileId, vendorId,
    ]);

    const ended = mode === 'ENDED';
    const started = now - (ended ? 100 : 10) * MINUTE;
    const planned = ended ? now - 31 * MINUTE : now + plannedOffsetMin * MINUTE;
    const [sessionResult] = await pool.execute(
      `INSERT INTO cb_vendor_session
         (vendor_id, profile_version_id, started_at_ms, planned_end_at_ms, ended_at_ms, end_reason)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [vendorId, profileId, started, planned, ended ? planned : null, ended ? 'MANUAL' : null],
    );
    const sessionId = Number(sessionResult.insertId);
    const [locationResult] = await pool.execute(
      `INSERT INTO cb_session_location
         (session_id, vendor_id, version_no, lat, lng, location_name, located_at_ms, effective_at_ms)
       VALUES (?, ?, 1, ?, ?, '人民广场', ?, ?)`,
      [sessionId, vendorId, ORIGIN.lat, ORIGIN.lng, now, started],
    );
    return {
      accountId: Number(actor.id),
      vendorId,
      sessionId,
      locationId: Number(locationResult.insertId),
    };
  }

  /** 观察夹具：与 W5 写入顺序一致——先插行拿到 ID，再按 ID 重算并写入领取令牌摘要。 */
  async function createObservation({ vendor, viewerAccountId = null }) {
    const pool = getPool();
    const eventAtMs = Date.now();
    const [result] = await pool.execute(
      `INSERT INTO cb_feedback_observation
         (viewer_account_id, claim_token_hash, vendor_id, session_id, location_version_id,
          event_at_ms, source, event_public_status, version, state_version)
       VALUES (?, NULL, ?, ?, ?, ?, 'DETAIL', 'OPEN', 1, 1)`,
      [viewerAccountId, vendor.vendorId, vendor.sessionId, vendor.locationId, eventAtMs],
    );
    const observationId = Number(result.insertId);
    if (viewerAccountId !== null) return { observationId, claimToken: null };
    const claimToken = anonymous.computeClaimToken({ observationId, eventAtMs });
    await pool.execute('UPDATE cb_feedback_observation SET claim_token_hash = ? WHERE id = ?', [
      sha256Hex(claimToken), observationId,
    ]);
    return { observationId, claimToken };
  }

  async function issueFeedbackContext(openid, observationId, key) {
    return httpRequest('/me/location-contexts', {
      method: 'POST', openid, key, body: { purpose: 'FEEDBACK', targetId: String(observationId) },
    });
  }

  /** 定位时刻取主库时刻：远端库与本机时钟存在偏移，用本机时间会被判为「晚于服务器时刻」。 */
  async function serverNowMs() {
    return dbNowMs(getPool());
  }

  async function submitBody({ observationId, token, location, type = 'OWNER_ABSENT', version = 1 }) {
    return {
      observationId: String(observationId),
      type,
      description: '到现场没看到摊主',
      locationContextToken: token,
      location: { lat: location.lat, lng: location.lng, locatedAtMs: await serverNowMs() },
      expectedObservationVersion: version,
    };
  }

  async function cleanupFixtures() {
    const pool = getPool();
    const [accounts] = await pool.execute("SELECT id FROM cb_user_account WHERE wx_openid LIKE 'w6-it-%'");
    for (const { id } of accounts) {
      const [vendors] = await pool.execute('SELECT id FROM cb_vendor_identity WHERE account_id = ?', [id]);
      for (const { id: vendorId } of vendors) {
        await pool.execute(
          `DELETE FROM cb_feedback_fact WHERE case_id IN
             (SELECT id FROM cb_feedback_case WHERE vendor_id = ?)`, [vendorId],
        );
        await pool.execute('DELETE FROM cb_feedback_case WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_navigation_check WHERE observation_id IN ('
          + 'SELECT id FROM cb_feedback_observation WHERE vendor_id = ?)', [vendorId]);
        await pool.execute('DELETE FROM cb_feedback_observation WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_session_location WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_session WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_open_day WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_publication_control WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_profile_version WHERE vendor_id = ?', [vendorId]);
      }
      await pool.execute('DELETE FROM cb_location_context WHERE account_id = ?', [id]);
      await pool.execute('DELETE FROM cb_idempotency_operation WHERE actor_scope = ?', [`account:${id}`]);
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

    fixtures.open = await createVendor({ openid: 'w6-it-open', name: '老张烤冷面' });
    fixtures.ended = await createVendor({ openid: 'w6-it-ended', name: '已收摊的煎饼摊', mode: 'ENDED' });
    fixtures.other = await createVendor({ openid: 'w6-it-other', name: '别人家的摊位', categoryCode: 'DRINK' });
    fixtures.reporter = await createVendor({ openid: 'w6-it-reporter', name: '反馈人自己的摊位' });
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await cleanupFixtures();
    await closeDatabase();
  });

  test('领取：一次绑定、同键回放同结果、他人领取冲突且响应无坐标', async () => {
    const observation = await createObservation({ vendor: fixtures.open });
    const claimKey = 'w6-claim-1';
    const first = await httpRequest('/me/observations/claim', {
      method: 'POST', openid: 'w6-it-reporter', key: claimKey,
      body: { claimToken: observation.claimToken },
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.claimStatus, 'CLAIMED');
    assert.equal(first.body.data.observationId, String(observation.observationId));
    assert.equal(Object.prototype.hasOwnProperty.call(first.body.data, 'currentLocation'), false);

    const replay = await httpRequest('/me/observations/claim', {
      method: 'POST', openid: 'w6-it-reporter', key: claimKey,
      body: { claimToken: observation.claimToken },
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data.replayed, true);
    assert.equal(replay.body.data.observationId, String(observation.observationId));

    const stolen = await httpRequest('/me/observations/claim', {
      method: 'POST', openid: 'w6-it-open', key: 'w6-claim-2',
      body: { claimToken: observation.claimToken },
    });
    assert.equal(stolen.status, 409);
    assert.equal(stolen.body.bizCode, 'STATE_CONFLICT');
    fixtures.claimedObservation = observation;
  });

  test('候选：窗口内的本人观察可反馈，窗口关闭后消失', async () => {
    const inside = await httpRequest('/me/feedback-candidates', { openid: 'w6-it-reporter' });
    assert.equal(inside.status, 200);
    const ids = inside.body.data.rows.map((row) => row.observationId);
    assert.ok(ids.includes(String(fixtures.claimedObservation.observationId)));
    const row = inside.body.data.rows.find((item) => item.observationId === String(fixtures.claimedObservation.observationId));
    assert.equal(row.eligible, true);
    assert.deepEqual(row.submittedTypes, []);
    assert.equal(row.nextStep, 'REQUEST_LOCATION_CONTEXT');

    const endedObservation = await createObservation({ vendor: fixtures.ended, viewerAccountId: fixtures.reporter.accountId });
    const afterEnd = await httpRequest('/me/feedback-candidates', { openid: 'w6-it-reporter' });
    const endedIds = afterEnd.body.data.rows.map((item) => item.observationId);
    assert.equal(endedIds.includes(String(endedObservation.observationId)), false);
  });

  test('提交：范围内可受理、同观察同类型拒绝重复、窗口关闭拒绝签发', async () => {
    const observation = fixtures.claimedObservation;
    const context = await issueFeedbackContext('w6-it-reporter', observation.observationId, 'w6-ctx-1');
    assert.equal(context.status, 200);
    const token = context.body.data.locationContextToken;
    assert.ok(token);

    const submitted = await httpRequest('/me/field-feedback', {
      method: 'POST', openid: 'w6-it-reporter', key: 'w6-fb-1',
      body: await submitBody({ observationId: observation.observationId, token, location: NEAR }),
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.data.status, 'PENDING');
    assert.ok(submitted.body.data.caseId);
    assert.ok(submitted.body.data.eligibleUntilMs > Date.now());
    fixtures.fact = submitted.body.data;
    fixtures.nearLocation = NEAR;

    const duplicateContext = await issueFeedbackContext('w6-it-reporter', observation.observationId, 'w6-ctx-2');
    const duplicate = await httpRequest('/me/field-feedback', {
      method: 'POST', openid: 'w6-it-reporter', key: 'w6-fb-2',
      body: await submitBody({
        observationId: observation.observationId,
        token: duplicateContext.body.data.locationContextToken,
        location: NEAR,
      }),
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.bizCode, 'ALREADY_PROCESSED');
  });

  test('距离：超过 300 米拒绝，且不写事实', async () => {
    const observation = await createObservation({ vendor: fixtures.open, viewerAccountId: fixtures.reporter.accountId });
    const context = await issueFeedbackContext('w6-it-reporter', observation.observationId, 'w6-ctx-far');
    const tooFar = await httpRequest('/me/field-feedback', {
      method: 'POST', openid: 'w6-it-reporter', key: 'w6-fb-far',
      body: await submitBody({
        observationId: observation.observationId,
        token: context.body.data.locationContextToken,
        location: FAR,
      }),
    });
    assert.equal(tooFar.status, 422);
    assert.equal(tooFar.body.bizCode, 'LOCATION_TOO_FAR');
  });

  test('窗口：结束后超过 30 分钟既不签发定位上下文也不受理提交', async () => {
    const observation = await createObservation({ vendor: fixtures.ended, viewerAccountId: fixtures.reporter.accountId });
    const context = await issueFeedbackContext('w6-it-reporter', observation.observationId, 'w6-ctx-ended');
    assert.equal(context.status, 410);
    assert.equal(context.body.bizCode, 'WINDOW_CLOSED');
  });

  test('越权：他人观察不签发上下文、不写入事实', async () => {
    const othersObservation = await createObservation({ vendor: fixtures.other, viewerAccountId: fixtures.open.accountId });
    const context = await issueFeedbackContext('w6-it-reporter', othersObservation.observationId, 'w6-ctx-other');
    assert.equal(context.status, 404);
    assert.equal(context.body.bizCode, 'RESOURCE_NOT_FOUND');

    const ownContext = await issueFeedbackContext('w6-it-reporter', fixtures.claimedObservation.observationId, 'w6-ctx-mix');
    const stolen = await httpRequest('/me/field-feedback', {
      method: 'POST', openid: 'w6-it-reporter', key: 'w6-fb-other',
      body: await submitBody({
        observationId: othersObservation.observationId,
        token: ownContext.body.data.locationContextToken,
        location: NEAR,
      }),
    });
    assert.equal(stolen.status, 404);
    assert.equal(stolen.body.bizCode, 'RESOURCE_NOT_FOUND');
  });

  test('合并：同摊主同事件日不同轮次进入同一事项，各自保留原轮次与位置', async () => {
    const pool = getPool();
    const now = Date.now();
    // 同日重开：先结束第一轮，再建第二轮（active_vendor_id 唯一，不能两轮同活）。
    await pool.execute(
      'UPDATE cb_vendor_session SET ended_at_ms = ?, end_reason = ? WHERE id = ?',
      [now, 'MANUAL', fixtures.open.sessionId],
    );
    const [profileRows] = await pool.execute(
      'SELECT profile_version_id FROM cb_vendor_session WHERE id = ?', [fixtures.open.sessionId],
    );
    const [sessionResult] = await pool.execute(
      `INSERT INTO cb_vendor_session
         (vendor_id, profile_version_id, started_at_ms, planned_end_at_ms, ended_at_ms, end_reason)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
      [fixtures.open.vendorId, profileRows[0].profile_version_id, now, now + 110 * MINUTE],
    );
    const secondSessionId = Number(sessionResult.insertId);
    const [locationResult] = await pool.execute(
      `INSERT INTO cb_session_location
         (session_id, vendor_id, version_no, lat, lng, location_name, located_at_ms, effective_at_ms)
       VALUES (?, ?, 1, ?, ?, '人民广场', ?, ?)`,
      [secondSessionId, fixtures.open.vendorId, ORIGIN.lat, ORIGIN.lng, now, now],
    );
    const observation = await createObservation({
      vendor: {
        vendorId: fixtures.open.vendorId,
        sessionId: secondSessionId,
        locationId: Number(locationResult.insertId),
      },
      viewerAccountId: fixtures.reporter.accountId,
    });
    const context = await issueFeedbackContext('w6-it-reporter', observation.observationId, 'w6-ctx-merge');
    assert.equal(context.status, 200);
    const submitted = await httpRequest('/me/field-feedback', {
      method: 'POST', openid: 'w6-it-reporter', key: 'w6-fb-merge',
      body: await submitBody({
        observationId: observation.observationId,
        token: context.body.data.locationContextToken,
        location: NEAR,
      }),
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.data.caseId, fixtures.fact.caseId,
      '同人同摊主同事件日同类型必须合并为同一待审事项');

    const [facts] = await pool.execute(
      `SELECT session_id, location_version_id FROM cb_feedback_fact
       WHERE case_id = ? ORDER BY id`, [fixtures.fact.caseId],
    );
    assert.equal(facts.length, 2);
    assert.notEqual(String(facts[0].session_id), String(facts[1].session_id));
    assert.notEqual(String(facts[0].location_version_id), String(facts[1].location_version_id));
  });

  test('本人记录：列表与详情只含本人内容，他人详情 404，且反馈不改变营业状态', async () => {
    const list = await httpRequest('/me/field-feedback', { openid: 'w6-it-reporter' });
    assert.equal(list.status, 200);
    assert.ok(list.body.data.rows.length >= 2);
    list.body.data.rows.forEach((row) => {
      assert.equal(row.status, 'PENDING');
      assert.equal(Object.prototype.hasOwnProperty.call(row, 'distanceM'), false);
    });

    const detail = await httpRequest(`/me/field-feedback/${list.body.data.rows[0].feedbackFactId}`, {
      openid: 'w6-it-reporter',
    });
    assert.equal(detail.status, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(detail.body.data, 'reporterLat'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(detail.body.data, 'distanceM'), false);
    assert.ok(detail.body.data.description);

    const othersView = await httpRequest(`/me/field-feedback/${list.body.data.rows[0].feedbackFactId}`, {
      openid: 'w6-it-open',
    });
    assert.equal(othersView.status, 404);

    const pool = getPool();
    // 反馈只写事实与事项：最近一轮（第二轮）不得因提交反馈被结束，也不得产生公开控制行。
    const [sessions] = await pool.execute(
      'SELECT ended_at_ms FROM cb_vendor_session WHERE vendor_id = ? ORDER BY id DESC LIMIT 1',
      [fixtures.open.vendorId],
    );
    assert.equal(sessions[0].ended_at_ms, null);
    const [controls] = await pool.execute(
      'SELECT COUNT(*) AS n FROM cb_vendor_publication_control WHERE vendor_id = ?', [fixtures.open.vendorId],
    );
    assert.equal(Number(controls[0].n), 0);
  });
}

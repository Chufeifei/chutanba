/**
 * W5 集成用例：公开集合、详情三态、观察事实、导航复核与发起。
 * 只连隔离库 phase1_test_w5，不触碰其他隔离库；夹具全部以 w5-it- 前缀创建并清理。
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');

const isolatedDatabase = process.env.PHASE1_TEST_DATABASE;
const useNamedPipe = process.env.PHASE1_TEST_HTTP_PIPE === '1';
const namedPipePath = `\\\\.\\pipe\\chutanba-w5-it-${process.pid}`;

if (!isolatedDatabase) {
  test('W5 integration requires PHASE1_TEST_* credentials', { skip: '未提供 phase1_test_w5 隔离库凭据' }, () => {});
} else {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_DEV_IDENTITY = 'true';
  process.env.DB_HOST = process.env.PHASE1_TEST_HOST || process.env.DB_HOST;
  process.env.DB_PORT = process.env.PHASE1_TEST_PORT || process.env.DB_PORT;
  process.env.DB_USER = process.env.PHASE1_TEST_USER;
  process.env.DB_PASSWORD = process.env.PHASE1_TEST_PASSWORD;
  process.env.DB_NAME = isolatedDatabase;
  process.env.PUBLIC_TOKEN_SECRET = 'w5-test-secret';
}

if (isolatedDatabase) {
  const app = require('../src/app');
  const { getPool, closeDatabase } = require('../src/db/pool');
  const { runPhase1Migrations } = require('../src/database/phase1/migration-runner');
  const account = require('../src/modules/account');
  const anonymous = require('../src/modules/discovery/anonymous');
  const env = require('../src/config/env');

  const MINUTE = 60_000;
  const identity = (openid) => ({ openid, unionid: null, userId: null, source: 'dev' });
  const LOCATION = { lat: 31.2304, lng: 121.4737, locationName: '人民广场' };
  const fixtures = {};
  let server = null;
  let anonToken = null;

  async function httpRequest(path, { method = 'GET', openid, token, body, key } = {}) {
    const headers = {};
    const payload = body === undefined ? null : JSON.stringify(body);
    if (payload !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (openid) headers['X-Dev-Openid'] = openid;
    if (token) headers['X-Anonymous-Session'] = token;
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
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: text ? JSON.parse(text) : null,
            raw: text,
          });
        });
      });
      request.on('error', reject);
      if (payload !== null) request.write(payload);
      request.end();
    });
  }

  async function createVendor({
    openid, categoryCode = 'SNACK', name = 'W5 摊位', mode = 'OPEN',
    selfStopped = false, governancePaused = false, withProfile = true, lng = LOCATION.lng,
  }) {
    const actor = await account.resolveAccount(identity(openid));
    const pool = getPool();
    const now = Date.now();
    const [vendorResult] = await pool.execute(
      `INSERT INTO cb_vendor_identity
         (account_id, vendor_code, lifecycle_status, active_profile_version_id, state_version, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'ACTIVE', NULL, 1, ?, ?)`,
      [actor.id, `W5IT${String(actor.id).padStart(8, '0')}`, now, now],
    );
    const vendorId = Number(vendorResult.insertId);
    let profileId = null;
    let sessionId = null;
    let locationId = null;
    if (withProfile) {
      const [profileResult] = await pool.execute(
        `INSERT INTO cb_vendor_profile_version
           (vendor_id, version_no, vendor_name, category_code, regular_items_text,
            price_description, announcement, review_status, submitted_at_ms, decided_at_ms)
         VALUES (?, 1, ?, ?, '常卖内容', '价格说明', '公告', 'APPROVED', ?, ?)`,
        [vendorId, name, categoryCode, now, now],
      );
      profileId = Number(profileResult.insertId);
      await pool.execute('UPDATE cb_vendor_identity SET active_profile_version_id = ? WHERE id = ?', [
        profileId, vendorId,
      ]);
    }
    if (withProfile && mode !== 'NO_SESSION') {
      const closed = mode === 'RESTING';
      const preparing = mode === 'PREPARING';
      // EXPIRED：轮次已过计划结束时刻但未物理结束，仍必须被资格谓词排除。
      const overdue = mode === 'EXPIRED';
      const started = now - (closed || preparing || overdue ? 100 : 10) * MINUTE;
      const planned = now + (preparing ? 10 : closed || overdue ? -10 : 110) * MINUTE;
      const ended = closed ? planned : null;
      const [sessionResult] = await pool.execute(
        `INSERT INTO cb_vendor_session
           (vendor_id, profile_version_id, started_at_ms, planned_end_at_ms, ended_at_ms, end_reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [vendorId, profileId, started, planned, ended, ended === null ? null : 'MANUAL'],
      );
      sessionId = Number(sessionResult.insertId);
      const [locationResult] = await pool.execute(
        `INSERT INTO cb_session_location
           (session_id, vendor_id, version_no, lat, lng, location_name, located_at_ms, effective_at_ms)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
        [sessionId, vendorId, LOCATION.lat, lng, LOCATION.locationName, now, started],
      );
      locationId = Number(locationResult.insertId);
    }
    if (selfStopped || governancePaused) {
      await pool.execute(
        `INSERT INTO cb_vendor_publication_control
           (vendor_id, self_stopped_at_ms, governance_paused_at_ms, state_version)
         VALUES (?, ?, ?, 1)`,
        [vendorId, selfStopped ? now : null, governancePaused ? now : null],
      );
    }
    return { vendorId, profileId, sessionId, locationId };
  }

  async function stopLocationAndMove(vendor) {
    const pool = getPool();
    const now = Date.now();
    await pool.execute(
      `UPDATE cb_session_location
       SET stopped_at_ms = ?, stop_reason = 'SUPERSEDED'
       WHERE session_id = ? AND stopped_at_ms IS NULL`,
      [now, vendor.sessionId],
    );
    const [result] = await pool.execute(
      `INSERT INTO cb_session_location
         (session_id, vendor_id, version_no, lat, lng, location_name, located_at_ms, effective_at_ms)
       VALUES (?, ?, 2, ?, ?, '移动后位置', ?, ?)`,
      [vendor.sessionId, vendor.vendorId, LOCATION.lat, LOCATION.lng + 0.01, now, now],
    );
    return Number(result.insertId);
  }

  async function insertRawExpiredCheck(vendor, sessionHash) {
    const pool = getPool();
    const createdAtMs = Date.now() - 2 * MINUTE;
    const [observationResult] = await pool.execute(
      `INSERT INTO cb_feedback_observation
         (viewer_account_id, claim_token_hash, vendor_id, session_id, location_version_id,
          event_at_ms, source, event_public_status, version, state_version)
       VALUES (NULL, NULL, ?, ?, ?, ?, 'NAVIGATION', 'OPEN', 1, 1)`,
      [vendor.vendorId, vendor.sessionId, vendor.locationId, createdAtMs],
    );
    const observationId = Number(observationResult.insertId);
    const [checkResult] = await pool.execute(
      `INSERT INTO cb_navigation_check
         (observation_id, anonymous_session_hash, session_id, location_version_id,
          decision, created_at_ms, expires_at_ms, state_version)
       VALUES (?, ?, ?, ?, 'READY', ?, ?, 1)`,
      [observationId, sessionHash, vendor.sessionId, vendor.locationId, createdAtMs, createdAtMs + 1_000],
    );
    return Number(checkResult.insertId);
  }

  async function cleanupFixtures() {
    const pool = getPool();
    const [accounts] = await pool.execute("SELECT id FROM cb_user_account WHERE wx_openid LIKE 'w5-it-%'");
    for (const { id } of accounts) {
      const [vendors] = await pool.execute('SELECT id FROM cb_vendor_identity WHERE account_id = ?', [id]);
      for (const { id: vendorId } of vendors) {
        await pool.execute(
          `DELETE FROM cb_navigation_check WHERE observation_id IN
             (SELECT id FROM cb_feedback_observation WHERE vendor_id = ?)`,
          [vendorId],
        );
        await pool.execute('DELETE FROM cb_feedback_observation WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_session_location WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_session WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_open_day WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_publication_control WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_profile_version WHERE vendor_id = ?', [vendorId]);
      }
      await pool.execute('DELETE FROM cb_location_context WHERE account_id = ?', [id]);
      await pool.execute('DELETE FROM cb_vendor_identity WHERE account_id = ?', [id]);
      await pool.execute("DELETE FROM cb_audit_event WHERE target_type = 'ACCOUNT' AND target_id = ?", [id]);
      await pool.execute('DELETE FROM cb_user_account WHERE id = ?', [id]);
    }
    await pool.execute("DELETE FROM cb_idempotency_operation WHERE actor_scope LIKE 'anon:%'");
  }

  before(async () => {
    const result = await runPhase1Migrations(getPool());
    assert.ok(result.applied.length > 0 || result.skipped.length > 0);
    await cleanupFixtures();
    server = useNamedPipe ? app.listen(namedPipePath) : app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));

    fixtures.open = await createVendor({ openid: 'w5-it-open', name: '烤冷面', lng: LOCATION.lng });
    fixtures.drink = await createVendor({
      openid: 'w5-it-drink', categoryCode: 'DRINK', name: '手打柠檬茶', lng: LOCATION.lng,
    });
    fixtures.preparing = await createVendor({
      openid: 'w5-it-preparing', mode: 'PREPARING', name: '准备收摊', lng: LOCATION.lng - 0.01,
    });
    fixtures.resting = await createVendor({ openid: 'w5-it-resting', mode: 'RESTING', name: '已收摊' });
    fixtures.expired = await createVendor({ openid: 'w5-it-expired', mode: 'EXPIRED', name: '到期未结束' });
    fixtures.noSession = await createVendor({ openid: 'w5-it-nosession', mode: 'NO_SESSION', name: '未出摊' });
    fixtures.noProfile = await createVendor({
      openid: 'w5-it-noprofile', withProfile: false, name: '无资料',
    });
    fixtures.selfStopped = await createVendor({ openid: 'w5-it-self', selfStopped: true, name: '本人停止' });
    fixtures.governance = await createVendor({
      openid: 'w5-it-gov', governancePaused: true, name: '治理暂停',
    });
    fixtures.move = await createVendor({ openid: 'w5-it-move', categoryCode: 'COFFEE', name: '会移动' });
    fixtures.selfMove = await createVendor({
      openid: 'w5-it-selfmove', categoryCode: 'OTHER', name: '复核后停止',
    });

    const categoriesCall = await httpRequest('/public/categories');
    anonToken = categoriesCall.headers['x-anonymous-session'];
    assert.ok(anonToken);
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await cleanupFixtures();
    await closeDatabase();
  });

  test('公开品类目录可匿名读取并签发匿名会话，响应不缓存', async () => {
    const response = await httpRequest('/public/categories');
    assert.equal(response.status, 200);
    assert.equal(response.body.data.version, 'v1');
    assert.equal(response.body.data.categories.length, 25);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(response.headers['x-anonymous-session'], /^[^.]+\.[^.]+\./);
  });

  test('公开集合只含资格成立对象，品类筛选与顾客定位生效', async () => {
    const all = await httpRequest('/public/vendors/search', {
      method: 'POST', token: anonToken, body: { viewerLocation: { lat: LOCATION.lat, lng: LOCATION.lng } },
    });
    assert.equal(all.status, 200);
    const ids = all.body.data.items.map((item) => item.vendorId);
    for (const name of ['open', 'drink', 'preparing', 'move']) {
      assert.ok(ids.includes(String(fixtures[name].vendorId)), `应包含 ${name}`);
    }
    for (const name of ['resting', 'expired', 'noSession', 'noProfile', 'selfStopped', 'governance']) {
      assert.equal(ids.includes(String(fixtures[name].vendorId)), false, `不应包含 ${name}`);
    }
    const distances = all.body.data.items.map((item) => item.distanceM);
    assert.ok(distances.every((value) => typeof value === 'number'));
    assert.deepEqual(distances, [...distances].sort((left, right) => left - right));
    // 同距离按 vendorId 升序：open 先于同时同点的 drink 创建，id 更小。
    assert.deepEqual(
      all.body.data.items.slice(0, 2).map((item) => item.vendorId),
      [String(fixtures.open.vendorId), String(fixtures.drink.vendorId)],
    );

    // 列表与地图同源：无定位两次调用返回同一快照版本与同一 items。
    const first = await httpRequest('/public/vendors/search', { method: 'POST', token: anonToken, body: {} });
    const second = await httpRequest('/public/vendors/search', { method: 'POST', token: anonToken, body: {} });
    assert.equal(first.body.data.snapshotVersion, second.body.data.snapshotVersion);
    assert.deepEqual(first.body.data.items, second.body.data.items);
    const noLocationIds = first.body.data.items.map((item) => item.vendorId);
    for (const name of ['open', 'drink', 'preparing', 'move']) {
      assert.ok(noLocationIds.includes(String(fixtures[name].vendorId)), `无定位仍返回 ${name}`);
    }
    assert.equal(first.body.data.items.some((item) => 'distanceM' in item), false);
    assert.deepEqual(
      first.body.data.items.map((item) => item.vendorId),
      [...first.body.data.items.map((item) => item.vendorId)].sort((left, right) => Number(left) - Number(right)),
    );

    const snack = await httpRequest('/public/vendors/search', {
      method: 'POST', token: anonToken, body: { categoryCode: 'SNACK' },
    });
    assert.equal(snack.status, 200);
    assert.deepEqual(
      snack.body.data.items.map((item) => item.vendorId).sort(),
      [String(fixtures.open.vendorId), String(fixtures.preparing.vendorId)].sort(),
    );
    assert.equal(snack.body.data.items.some((item) => 'distanceM' in item), false);

    const empty = await httpRequest('/public/vendors/search', {
      method: 'POST', token: anonToken, body: { categoryCode: 'BAKERY' },
    });
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.data.items, []);

    // 伪造身份头不改变公开结果。
    const forged = await httpRequest('/public/vendors/search', {
      method: 'POST', token: anonToken, openid: 'w5-it-open', body: {},
    });
    assert.deepEqual(forged.body.data.items, first.body.data.items);

    const rejected = await httpRequest('/public/vendors/search', {
      method: 'POST', token: anonToken, body: { regionId: 'x', radiusM: 500 },
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.bizCode, 'VALIDATION_FAILED');
  });

  test('集合超限返回 SNAPSHOT_TOO_LARGE，绝不截断', async () => {
    const savedMax = env.publicTokens.snapshotMax;
    env.publicTokens.snapshotMax = 1;
    try {
      const response = await httpRequest('/public/vendors/search', {
        method: 'POST', token: anonToken, body: {},
      });
      assert.equal(response.status, 503);
      assert.equal(response.body.bizCode, 'SNAPSHOT_TOO_LARGE');
      assert.equal(response.body.data, null);
    } finally {
      env.publicTokens.snapshotMax = savedMax;
    }
  });

  test('详情三态：营业含轮次与坐标，休息与不可查看不带坐标', async () => {
    const open = await httpRequest(`/public/vendors/${fixtures.open.vendorId}`);
    assert.equal(open.status, 200);
    assert.equal(open.body.data.availability, 'OPEN');
    assert.equal(open.body.data.sessionSummary.sessionId, String(fixtures.open.sessionId));
    assert.equal(
      open.body.data.sessionSummary.locationVersionId,
      String(fixtures.open.locationId),
    );
    assert.equal(open.body.data.currentLocation.lat, LOCATION.lat);
    assert.equal(open.headers['cache-control'], 'no-store');

    const resting = await httpRequest(`/public/vendors/${fixtures.resting.vendorId}`);
    assert.equal(resting.body.data.availability, 'RESTING');
    assert.equal('currentLocation' in resting.body.data, false);
    assert.equal('sessionSummary' in resting.body.data, false);
    assert.equal(resting.raw.includes('31.2304'), false);

    const noSession = await httpRequest(`/public/vendors/${fixtures.noSession.vendorId}`);
    assert.equal(noSession.body.data.availability, 'RESTING');

    const expired = await httpRequest(`/public/vendors/${fixtures.expired.vendorId}`);
    assert.equal(expired.body.data.availability, 'RESTING');
    assert.equal('currentLocation' in expired.body.data, false);

    // 伪造身份头不改变公开详情。
    const forgedDetail = await httpRequest(`/public/vendors/${fixtures.open.vendorId}`, {
      openid: 'w5-it-open',
    });
    assert.equal(forgedDetail.body.data.availability, open.body.data.availability);
    assert.deepEqual(forgedDetail.body.data.profile, open.body.data.profile);
    assert.equal(forgedDetail.body.data.sessionSummary.sessionId, open.body.data.sessionSummary.sessionId);
    assert.deepEqual(forgedDetail.body.data.currentLocation, open.body.data.currentLocation);

    for (const name of ['selfStopped', 'governance', 'noProfile']) {
      const hidden = await httpRequest(`/public/vendors/${fixtures[name].vendorId}`);
      assert.equal(hidden.body.data.availability, 'UNVIEWABLE', name);
      assert.equal('profile' in hidden.body.data, false);
      assert.equal(hidden.raw.includes('31.2304'), false);
    }

    const missing = await httpRequest('/public/vendors/999999999');
    assert.equal(missing.status, 200);
    assert.equal(missing.body.data.availability, 'UNVIEWABLE');

    const malformed = await httpRequest('/public/vendors/abc');
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.bizCode, 'VALIDATION_FAILED');
  });

  test('详情观察：匿名签发领取令牌，识别身份写账号，过时版本拒绝', async () => {
    const sessionSummary = {
      sessionId: String(fixtures.open.sessionId),
      locationVersionId: String(fixtures.open.locationId),
    };
    const body = { source: 'DETAIL', ...sessionSummary };
    const first = await httpRequest(`/public/vendors/${fixtures.open.vendorId}/observations`, {
      method: 'POST', token: anonToken, key: 'w5-obs-anon-1', body,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.vendorSummary.name, '烤冷面');
    assert.equal(first.body.data.claimToken.split('.').length, 3);
    assert.equal('currentLocation' in first.body.data, false);
    assert.ok(first.body.data.eventAtMs > 0);

    const replay = await httpRequest(`/public/vendors/${fixtures.open.vendorId}/observations`, {
      method: 'POST', token: anonToken, key: 'w5-obs-anon-1', body,
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data.observationId, first.body.data.observationId);

    const stale = await httpRequest(`/public/vendors/${fixtures.open.vendorId}/observations`, {
      method: 'POST', token: anonToken, key: 'w5-obs-anon-2',
      body: { source: 'DETAIL', sessionId: '999999', locationVersionId: sessionSummary.locationVersionId },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.bizCode, 'STATE_CONFLICT');

    // 同键异体必须明确拒绝，不能把第二个内容当作回放。
    const mismatch = await httpRequest(`/public/vendors/${fixtures.open.vendorId}/observations`, {
      method: 'POST', token: anonToken, key: 'w5-obs-anon-1',
      body: { source: 'DETAIL', sessionId: String(fixtures.drink.sessionId), locationVersionId: String(fixtures.drink.locationId) },
    });
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.body.bizCode, 'IDEMPOTENCY_MISMATCH');

    const identified = await httpRequest(`/public/vendors/${fixtures.open.vendorId}/observations`, {
      method: 'POST', openid: 'w5-it-viewer', token: anonToken, key: 'w5-obs-known-1', body,
    });
    assert.equal(identified.status, 200);
    assert.equal('claimToken' in identified.body.data, false);

    const selfEventTime = await httpRequest(`/public/vendors/${fixtures.open.vendorId}/observations`, {
      method: 'POST', token: anonToken, key: 'w5-obs-anon-3', body: { ...body, eventAtMs: Date.now() },
    });
    assert.equal(selfEventTime.status, 400);
    assert.equal(selfEventTime.body.bizCode, 'VALIDATION_FAILED');

    const resting = await httpRequest(`/public/vendors/${fixtures.resting.vendorId}/observations`, {
      method: 'POST', token: anonToken, key: 'w5-obs-resting-1',
      body: { source: 'DETAIL', sessionId: String(fixtures.resting.sessionId), locationVersionId: String(fixtures.resting.locationId) },
    });
    assert.equal(resting.status, 409);
  });

  test('导航复核：营业返回 READY 且无坐标，版本变化与休息对象拒绝', async () => {
    const ready = await httpRequest(`/public/vendors/${fixtures.open.vendorId}/navigation-check`, {
      method: 'POST', token: anonToken, key: 'w5-nav-ready-1', body: {},
    });
    assert.equal(ready.status, 200);
    assert.equal(ready.body.data.decision, 'READY');
    assert.equal(ready.body.data.sessionId, String(fixtures.open.sessionId));
    assert.equal(ready.body.data.locationVersionId, String(fixtures.open.locationId));
    assert.equal('currentLocation' in ready.body.data, false);
    assert.equal(ready.raw.includes('31.2304'), false);

    const replay = await httpRequest(`/public/vendors/${fixtures.open.vendorId}/navigation-check`, {
      method: 'POST', token: anonToken, key: 'w5-nav-ready-1', body: {},
    });
    assert.equal(replay.body.data.navigationCheckId, ready.body.data.navigationCheckId);

    const stale = await httpRequest(`/public/vendors/${fixtures.open.vendorId}/navigation-check`, {
      method: 'POST', token: anonToken, key: 'w5-nav-stale-1',
      body: { expectedSessionId: '999999' },
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.bizCode, 'STATE_CONFLICT');

    const resting = await httpRequest(`/public/vendors/${fixtures.resting.vendorId}/navigation-check`, {
      method: 'POST', token: anonToken, key: 'w5-nav-resting-1', body: {},
    });
    assert.equal(resting.status, 422);
    assert.equal(resting.body.bizCode, 'NOT_NAVIGABLE');

    const preparing = await httpRequest(`/public/vendors/${fixtures.preparing.vendorId}/navigation-check`, {
      method: 'POST', token: anonToken, key: 'w5-nav-preparing-1', body: {},
    });
    assert.equal(preparing.body.data.decision, 'CONFIRM_REQUIRED');
    assert.ok(preparing.body.data.plannedEndAtMs > preparing.body.data.remainingMs);
    assert.equal('sessionId' in preparing.body.data, false);
    assert.equal(preparing.raw.includes('31.2304'), false);

    const confirmed = await httpRequest(`/public/vendors/${fixtures.preparing.vendorId}/navigation-check`, {
      method: 'POST', token: anonToken, key: 'w5-nav-preparing-2', body: { confirmPrepared: true },
    });
    assert.equal(confirmed.body.data.decision, 'READY');
  });

  test('导航发起：仅 READY 且归属本匿名会话；成功才返回坐标', async () => {
    const check = await httpRequest(`/public/vendors/${fixtures.open.vendorId}/navigation-check`, {
      method: 'POST', token: anonToken, key: 'w5-nav-launch-src', body: {},
    });
    const checkId = check.body.data.navigationCheckId;

    const categoriesCall = await httpRequest('/public/categories');
    const otherToken = categoriesCall.headers['x-anonymous-session'];
    const foreign = await httpRequest('/public/navigation-launches', {
      method: 'POST', token: otherToken, key: 'w5-launch-foreign',
      body: { navigationCheckId: checkId },
    });
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body.bizCode, 'RESOURCE_NOT_FOUND');

    const launched = await httpRequest('/public/navigation-launches', {
      method: 'POST', token: anonToken, key: 'w5-launch-1', body: { navigationCheckId: checkId },
    });
    assert.equal(launched.status, 200);
    assert.equal(launched.body.data.launchId.length, 32);
    assert.equal(launched.body.data.currentLocation.lat, LOCATION.lat);

    const replay = await httpRequest('/public/navigation-launches', {
      method: 'POST', token: anonToken, key: 'w5-launch-1', body: { navigationCheckId: checkId },
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data.launchId, launched.body.data.launchId);

    const again = await httpRequest('/public/navigation-launches', {
      method: 'POST', token: anonToken, key: 'w5-launch-2', body: { navigationCheckId: checkId },
    });
    assert.equal(again.status, 409);
    assert.equal(again.body.bizCode, 'STATE_CONFLICT');
  });

  test('复核后位置变化或本人停止：发起拒绝且无坐标', async () => {
    const moveCheck = await httpRequest(`/public/vendors/${fixtures.move.vendorId}/navigation-check`, {
      method: 'POST', token: anonToken, key: 'w5-nav-move', body: {},
    });
    assert.equal(moveCheck.body.data.decision, 'READY');
    await stopLocationAndMove(fixtures.move);
    const moved = await httpRequest('/public/navigation-launches', {
      method: 'POST', token: anonToken, key: 'w5-launch-move',
      body: { navigationCheckId: moveCheck.body.data.navigationCheckId },
    });
    assert.equal(moved.status, 422);
    assert.equal(moved.body.bizCode, 'NOT_NAVIGABLE');
    assert.equal(moved.raw.includes('31.2304'), false);

    const selfCheck = await httpRequest(`/public/vendors/${fixtures.selfMove.vendorId}/navigation-check`, {
      method: 'POST', token: anonToken, key: 'w5-nav-self', body: {},
    });
    await getPool().execute(
      `INSERT INTO cb_vendor_publication_control (vendor_id, self_stopped_at_ms, state_version)
       VALUES (?, ?, 1)`,
      [fixtures.selfMove.vendorId, Date.now()],
    );
    const stopped = await httpRequest('/public/navigation-launches', {
      method: 'POST', token: anonToken, key: 'w5-launch-self',
      body: { navigationCheckId: selfCheck.body.data.navigationCheckId },
    });
    assert.equal(stopped.status, 422);
    assert.equal(stopped.body.bizCode, 'NOT_NAVIGABLE');
  });

  test('复核已过期返回 CONTEXT_EXPIRED', async () => {
    const expiredCheckId = await insertRawExpiredCheck(fixtures.open, anonymous.hashToken(anonToken));
    const response = await httpRequest('/public/navigation-launches', {
      method: 'POST', token: anonToken, key: 'w5-launch-expired',
      body: { navigationCheckId: String(expiredCheckId) },
    });
    assert.equal(response.status, 410);
    assert.equal(response.body.bizCode, 'CONTEXT_EXPIRED');
  });

  test('六个公开端点均返回 no-store', async () => {
    const version = { source: 'DETAIL', sessionId: String(fixtures.open.sessionId), locationVersionId: String(fixtures.open.locationId) };
    const check = await httpRequest(`/public/vendors/${fixtures.open.vendorId}/navigation-check`, {
      method: 'POST', token: anonToken, key: 'w5-nostore-nav', body: {},
    });
    const responses = [
      await httpRequest('/public/categories'),
      await httpRequest('/public/vendors/search', { method: 'POST', token: anonToken, body: {} }),
      await httpRequest(`/public/vendors/${fixtures.open.vendorId}`),
      await httpRequest(`/public/vendors/${fixtures.open.vendorId}/observations`, {
        method: 'POST', token: anonToken, key: 'w5-nostore-obs', body: version,
      }),
      check,
      await httpRequest('/public/navigation-launches', {
        method: 'POST', token: anonToken, key: 'w5-nostore-launch',
        body: { navigationCheckId: check.body.data.navigationCheckId },
      }),
    ];
    for (const response of responses) {
      assert.equal(response.status === 200 || response.status === 202, true);
      assert.equal(response.headers['cache-control'], 'no-store');
    }
  });

  test('令牌密钥缺失时读端点可用、写端点 503', async () => {
    const savedSecret = env.publicTokens.secret;
    env.publicTokens.secret = null;
    try {
      const categoriesCall = await httpRequest('/public/categories');
      assert.equal(categoriesCall.status, 200);
      assert.equal('x-anonymous-session' in categoriesCall.headers, false);

      const observation = await httpRequest(`/public/vendors/${fixtures.open.vendorId}/observations`, {
        method: 'POST', key: 'w5-obs-nosecret',
        body: {
          source: 'DETAIL',
          sessionId: String(fixtures.open.sessionId),
          locationVersionId: String(fixtures.open.locationId),
        },
      });
      assert.equal(observation.status, 503);
      assert.equal(observation.body.bizCode, 'SERVICE_UNAVAILABLE');
    } finally {
      env.publicTokens.secret = savedSecret;
    }
  });
}

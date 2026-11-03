/**
 * W4 集成用例：营业轮次、位置版本、出摊日与两类公开控制。
 * 只连隔离库 phase1_test_w4，不触碰 chutanba 与 W1～W3 隔离库。
 */
const assert = require('node:assert/strict');
const http = require('node:http');
const { after, before, test } = require('node:test');

const isolatedDatabase = process.env.PHASE1_TEST_DATABASE;
// 本机启用代理 TUN／回环拦截时，TCP 回环连接会被丢弃（连未监听端口立刻 RST，连已监听端口超时）。
// 这类环境用 PHASE1_TEST_HTTP_PIPE=1 改走 Windows 命名管道，业务断言完全一致。
const useNamedPipe = process.env.PHASE1_TEST_HTTP_PIPE === '1';
const namedPipePath = `\\\\.\\pipe\\chutanba-w4-it-${process.pid}`;

if (!isolatedDatabase) {
  test('W4 integration requires PHASE1_TEST_* credentials', { skip: '未提供 phase1_test_w4 隔离库凭据' }, () => {});
} else {
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_DEV_IDENTITY = 'true';
  // 治理暂停从 W7 起只有管理入口：W4 用例经部署名单取得 ADMIN 能力后再调用。
  process.env.ADMIN_OPENIDS = process.env.ADMIN_OPENIDS || 'w4-it-admin';
  process.env.DB_HOST = process.env.PHASE1_TEST_HOST || process.env.DB_HOST;
  process.env.DB_PORT = process.env.PHASE1_TEST_PORT || process.env.DB_PORT;
  process.env.DB_USER = process.env.PHASE1_TEST_USER;
  process.env.DB_PASSWORD = process.env.PHASE1_TEST_PASSWORD;
  process.env.DB_NAME = isolatedDatabase;
  process.env.LOCATION_CONTEXT_SECRET = process.env.LOCATION_CONTEXT_SECRET || 'w4-test-secret';
}

if (isolatedDatabase) {
  const app = require('../src/app');
  const { getPool, closeDatabase } = require('../src/db/pool');
  const { runPhase1Migrations } = require('../src/database/phase1/migration-runner');
  const account = require('../src/modules/account');
  const session = require('../src/modules/session');
  const management = require('../src/modules/management');
  const publication = require('../src/modules/publication');

  const HOUR = 3_600_000;
  const MINUTE = 60_000;
  const location = { lat: 31.2304, lng: 121.4737, locationName: '人民广场' };
  const identity = (openid) => ({ openid, unionid: null, userId: null, source: 'dev' });

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

  async function vendorStateVersion(vendorId) {
    const [rows] = await getPool().execute(
      'SELECT state_version FROM cb_vendor_identity WHERE id = ?', [vendorId],
    );
    return Number(rows[0].state_version);
  }

  async function createVendor(openid, { withProfile = true } = {}) {
    const actor = await account.resolveAccount(identity(openid));
    const now = Date.now();
    const [result] = await getPool().execute(
      `INSERT INTO cb_vendor_identity
         (account_id, vendor_code, lifecycle_status, active_profile_version_id, state_version, created_at_ms, updated_at_ms)
       VALUES (?, ?, 'ACTIVE', ?, 1, ?, ?)`,
      [actor.id, `W4IT${String(actor.id).padStart(8, '0')}`, withProfile ? 900000 + actor.id : null, now, now],
    );
    return { vendorId: Number(result.insertId), accountId: actor.id, openid };
  }

  /** 走完整「尝试 → 定位上下文 → 开摊」链路，供多个用例复用。 */
  async function openVendor(vendor, { prefix, offsetMs = 2 * HOUR, name = location.locationName } = {}) {
    const tag = prefix || `w4-${Date.now()}`;
    const plannedEndAtMs = Date.now() + offsetMs;
    const attempt = await session.createOpenAttempt(identity(vendor.openid), `${tag}-attempt`, {
      plannedEndAtMs, expectedVendorVersion: await vendorStateVersion(vendor.vendorId),
    });
    const context = await session.issueLocationContext(identity(vendor.openid), `${tag}-ctx`, {
      purpose: 'OPEN', targetId: attempt.attemptId,
    });
    const opened = await session.openSession(identity(vendor.openid), `${tag}-open`, {
      attemptId: attempt.attemptId,
      plannedEndAtMs,
      locationContextToken: context.locationContextToken,
      location: { ...location, locationName: name, locatedAtMs: context.issuedAtMs },
      expectedVendorVersion: await vendorStateVersion(vendor.vendorId),
    });
    return { tag, plannedEndAtMs, attempt, context, opened };
  }

  async function cleanupFixtures() {
    const pool = getPool();
    const [accounts] = await pool.execute("SELECT id FROM cb_user_account WHERE wx_openid LIKE 'w4-it-%'");
    for (const { id } of accounts) {
      const [vendors] = await pool.execute('SELECT id FROM cb_vendor_identity WHERE account_id = ?', [id]);
      for (const { id: vendorId } of vendors) {
        const [sessions] = await pool.execute('SELECT id FROM cb_vendor_session WHERE vendor_id = ?', [vendorId]);
        const [attempts] = await pool.execute('SELECT id FROM cb_vendor_open_attempt WHERE vendor_id = ?', [vendorId]);
        for (const { id: sessionId } of sessions) {
          await pool.execute("DELETE FROM cb_audit_event WHERE target_type = 'SESSION' AND target_id = ?", [sessionId]);
        }
        for (const { id: attemptId } of attempts) {
          await pool.execute(
            "DELETE FROM cb_audit_event WHERE target_type = 'OPEN_ATTEMPT' AND target_id = ?", [attemptId],
          );
        }
        await pool.execute("DELETE FROM cb_audit_event WHERE target_type = 'VENDOR' AND target_id = ?", [vendorId]);
        await pool.execute('DELETE FROM cb_session_location WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_session WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_open_day WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_open_attempt WHERE vendor_id = ?', [vendorId]);
        await pool.execute('DELETE FROM cb_vendor_publication_control WHERE vendor_id = ?', [vendorId]);
      }
      await pool.execute('DELETE FROM cb_location_context WHERE account_id = ?', [id]);
      await pool.execute('DELETE FROM cb_vendor_identity WHERE account_id = ?', [id]);
      await pool.execute('DELETE FROM cb_idempotency_operation WHERE actor_scope = ?', [`account:${id}`]);
      await pool.execute("DELETE FROM cb_audit_event WHERE target_type = 'ACCOUNT' AND target_id = ?", [id]);
      await pool.execute('DELETE FROM cb_user_account WHERE id = ?', [id]);
    }
  }

  before(async () => {
    const result = await runPhase1Migrations(getPool());
    assert.ok(result.applied.length > 0 || result.skipped.length > 0);
    await cleanupFixtures();
    server = useNamedPipe ? app.listen(namedPipePath) : app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await cleanupFixtures();
    await closeDatabase();
  });

  test('无摊主时工作台与公开控制返回 404', async () => {
    const openid = 'w4-it-novendor';
    const workbench = await httpRequest('/vendor/workbench', { openid });
    assert.equal(workbench.status, 404);
    assert.equal(workbench.body.bizCode, 'RESOURCE_NOT_FOUND');

    const controls = await httpRequest('/vendor/publication', { openid });
    assert.equal(controls.status, 404);

    const me = await httpRequest('/me', { openid });
    assert.equal(me.status, 200);
    assert.equal(me.body.data.vendorId, undefined);
    assert.equal(me.body.data.profileState, 'NONE');
    assert.equal('selfStoppedAtMs' in me.body.data, false);
  });

  test('无生效资料开摊尝试返回 NOT_ELIGIBLE，结束时间非法返回 TIME_INVALID', async () => {
    const vendor = await createVendor('w4-it-noprofile', { withProfile: false });
    await assert.rejects(
      () => session.createOpenAttempt(identity(vendor.openid), 'w4-noprofile-a', {
        plannedEndAtMs: Date.now() + HOUR, expectedVendorVersion: 1,
      }),
      (error) => error.bizCode === 'NOT_ELIGIBLE',
    );

    const withProfile = await createVendor('w4-it-time');
    await assert.rejects(
      () => session.createOpenAttempt(identity(withProfile.openid), 'w4-time-a', {
        plannedEndAtMs: Date.now(), expectedVendorVersion: 1,
      }),
      (error) => error.bizCode === 'TIME_INVALID',
    );
    await assert.rejects(
      () => session.createOpenAttempt(identity(withProfile.openid), 'w4-time-b', {
        plannedEndAtMs: Date.now() + 13 * HOUR, expectedVendorVersion: 1,
      }),
      (error) => error.bizCode === 'TIME_INVALID',
    );
    await assert.rejects(
      () => session.createOpenAttempt(identity(withProfile.openid), 'w4-time-c', {
        plannedEndAtMs: Date.now() + HOUR, expectedVendorVersion: 9,
      }),
      (error) => error.bizCode === 'STATE_CONFLICT' && error.data.resource === 'vendor',
    );
  });

  test('首次开摊创建轮次、位置、出摊日与审计，工作台呈 OPEN', async () => {
    const vendor = await createVendor('w4-it-open');
    const { opened } = await openVendor(vendor, { prefix: 'w4-open' });
    assert.equal(opened.stateVersion, 2);
    assert.match(opened.openDate, /^\d{4}-\d{2}-\d{2}$/);

    const workbench = await session.getWorkbench(identity(vendor.openid));
    assert.equal(workbench.phase, 'OPEN');
    assert.ok(workbench.remainingMs > 0);
    assert.equal(workbench.session.sessionId, opened.sessionId);
    assert.equal(workbench.currentLocation.locationName, location.locationName);
    assert.equal(workbench.profileEligibility.eligible, false);
    assert.deepEqual(workbench.profileEligibility.reasons, ['SESSION_ACTIVE']);
    const candidate = workbench.openTimeCandidates.defaultCandidate;
    assert.ok(candidate.atMs > workbench.serverNowMs);
    assert.ok(candidate.atMs - workbench.serverNowMs <= 12 * HOUR);

    const [audits] = await getPool().execute(
      "SELECT action_code FROM cb_audit_event WHERE target_type = 'SESSION' AND target_id = ?", [opened.sessionId],
    );
    assert.ok(audits.some((row) => row.action_code === 'SESSION_OPENED'));

    const [days] = await getPool().execute(
      'SELECT open_date FROM cb_vendor_open_day WHERE vendor_id = ?', [vendor.vendorId],
    );
    assert.equal(days.length, 1);
  });

  test('定位上下文一次性：重复消费与超时都被拒绝', async () => {
    const vendor = await createVendor('w4-it-context');
    const plannedEndAtMs = Date.now() + 2 * HOUR;
    const attempt = await session.createOpenAttempt(identity(vendor.openid), 'w4-ctx-attempt', {
      plannedEndAtMs, expectedVendorVersion: 1,
    });
    const context = await session.issueLocationContext(identity(vendor.openid), 'w4-ctx-issue', {
      purpose: 'OPEN', targetId: attempt.attemptId,
    });
    const input = {
      attemptId: attempt.attemptId,
      plannedEndAtMs,
      locationContextToken: context.locationContextToken,
      location: { ...location, locatedAtMs: context.issuedAtMs },
      expectedVendorVersion: 1,
    };
    await session.openSession(identity(vendor.openid), 'w4-ctx-open', input);
    // 在途轮次先于尝试校验拦截（design §6 第 4 步），因此重放同一尝试拿到的是轮次冲突。
    await assert.rejects(
      () => session.openSession(identity(vendor.openid), 'w4-ctx-open-2', { ...input, expectedVendorVersion: 2 }),
      (error) => error.bizCode === 'STATE_CONFLICT' && error.data.resource === 'session',
    );

    // 已消费但未形成轮次的上下文：再次消费只能是 CONTEXT_EXPIRED，且不留下营业事实。
    const usedVendor = await createVendor('w4-it-context-used');
    const usedAttempt = await session.createOpenAttempt(identity(usedVendor.openid), 'w4-used-attempt', {
      plannedEndAtMs, expectedVendorVersion: 1,
    });
    const usedContext = await session.issueLocationContext(identity(usedVendor.openid), 'w4-used-issue', {
      purpose: 'OPEN', targetId: usedAttempt.attemptId,
    });
    await getPool().execute(
      'UPDATE cb_location_context SET used_at_ms = ?, state_version = state_version + 1 WHERE account_id = ?',
      [Date.now(), usedVendor.accountId],
    );
    await assert.rejects(
      () => session.openSession(identity(usedVendor.openid), 'w4-used-open', {
        attemptId: usedAttempt.attemptId,
        plannedEndAtMs,
        locationContextToken: usedContext.locationContextToken,
        location: { ...location, locatedAtMs: usedContext.issuedAtMs },
        expectedVendorVersion: 1,
      }),
      (error) => error.bizCode === 'CONTEXT_EXPIRED',
    );
    const [usedSessions] = await getPool().execute(
      'SELECT COUNT(*) AS total FROM cb_vendor_session WHERE vendor_id = ?', [usedVendor.vendorId],
    );
    assert.equal(Number(usedSessions[0].total), 0);

    const vendor2 = await createVendor('w4-it-context-expire');
    const attempt2 = await session.createOpenAttempt(identity(vendor2.openid), 'w4-exp-attempt', {
      plannedEndAtMs, expectedVendorVersion: 1,
    });
    const context2 = await session.issueLocationContext(identity(vendor2.openid), 'w4-exp-issue', {
      purpose: 'OPEN', targetId: attempt2.attemptId,
    });
    // 约束要求 expires_at_ms > issued_at_ms，所以整对时间一起往前挪到已过期。
    await getPool().execute(
      'UPDATE cb_location_context SET issued_at_ms = ?, expires_at_ms = ? WHERE account_id = ?',
      [Date.now() - 10 * MINUTE, Date.now() - 5 * MINUTE, vendor2.accountId],
    );
    await assert.rejects(
      () => session.openSession(identity(vendor2.openid), 'w4-exp-open', {
        attemptId: attempt2.attemptId,
        plannedEndAtMs,
        locationContextToken: context2.locationContextToken,
        location: { ...location, locatedAtMs: Date.now() - 1000 },
        expectedVendorVersion: 1,
      }),
      (error) => error.bizCode === 'CONTEXT_EXPIRED',
    );
  });

  test('刷新把旧位置标记 REPLACED，失败刷新保留最新位置且不增加出摊日', async () => {
    const vendor = await createVendor('w4-it-refresh');
    const { opened } = await openVendor(vendor, { prefix: 'w4-refresh' });
    const context = await session.issueLocationContext(identity(vendor.openid), 'w4-refresh-refresh-ctx', {
      purpose: 'REFRESH', targetId: opened.sessionId,
    });
    const refreshed = await session.refreshLocation(identity(vendor.openid), opened.sessionId, 'w4-refresh-1', {
      locationContextToken: context.locationContextToken,
      location: { ...location, locationName: '新位置', locatedAtMs: context.issuedAtMs },
      expectedSessionVersion: 1,
    });
    assert.notEqual(refreshed.locationVersionId, opened.locationVersionId);

    const [locations] = await getPool().execute(
      'SELECT version_no, location_name, stopped_at_ms, stop_reason FROM cb_session_location WHERE session_id = ? ORDER BY version_no',
      [opened.sessionId],
    );
    assert.equal(locations.length, 2);
    assert.equal(locations[0].stop_reason, 'REPLACED');
    assert.ok(locations[0].stopped_at_ms !== null);
    assert.equal(locations[1].stopped_at_ms, null);

    // 用同一令牌再刷新必然失败，且不改变最后成功位置。
    await assert.rejects(
      () => session.refreshLocation(identity(vendor.openid), opened.sessionId, 'w4-refresh-2', {
        locationContextToken: context.locationContextToken,
        location: { ...location, locationName: '再次刷新', locatedAtMs: Date.now() },
        expectedSessionVersion: 2,
      }),
      (error) => error.bizCode === 'CONTEXT_EXPIRED',
    );
    const [after] = await getPool().execute(
      'SELECT COUNT(*) AS total FROM cb_session_location WHERE session_id = ?', [opened.sessionId],
    );
    assert.equal(Number(after[0].total), 2);
    const [days] = await getPool().execute(
      'SELECT COUNT(*) AS total FROM cb_vendor_open_day WHERE vendor_id = ?', [vendor.vendorId],
    );
    assert.equal(Number(days[0].total), 1);
  });

  test('同键回放不产生第二条事实，同键异内容返回 IDEMPOTENCY_MISMATCH', async () => {
    const vendor = await createVendor('w4-it-idem');
    const plannedEndAtMs = Date.now() + 2 * HOUR;
    const attempt = await session.createOpenAttempt(identity(vendor.openid), 'w4-idem-attempt', {
      plannedEndAtMs, expectedVendorVersion: 1,
    });
    const context = await session.issueLocationContext(identity(vendor.openid), 'w4-idem-ctx', {
      purpose: 'OPEN', targetId: attempt.attemptId,
    });
    const input = {
      attemptId: attempt.attemptId,
      plannedEndAtMs,
      locationContextToken: context.locationContextToken,
      location: { ...location, locatedAtMs: context.issuedAtMs },
      expectedVendorVersion: 1,
    };
    const first = await session.openSession(identity(vendor.openid), 'w4-idem-open', input);
    const replayed = await session.openSession(identity(vendor.openid), 'w4-idem-open', input);
    assert.equal(replayed.sessionId, first.sessionId);
    assert.equal(replayed.replayed, true);

    await assert.rejects(
      () => session.openSession(identity(vendor.openid), 'w4-idem-open', { ...input, plannedEndAtMs: plannedEndAtMs + 1 }),
      (error) => error.bizCode === 'IDEMPOTENCY_MISMATCH',
    );
    const [sessions] = await getPool().execute(
      'SELECT COUNT(*) AS total FROM cb_vendor_session WHERE vendor_id = ?', [vendor.vendorId],
    );
    assert.equal(Number(sessions[0].total), 1);
  });

  test('两个不同幂等键并发开摊只成立一条轮次', async () => {
    const vendor = await createVendor('w4-it-concurrent');
    const plannedEndAtMs = Date.now() + 2 * HOUR;
    const attemptA = await session.createOpenAttempt(identity(vendor.openid), 'w4-conc-attempt-a', {
      plannedEndAtMs, expectedVendorVersion: 1,
    });
    const attemptB = await session.createOpenAttempt(identity(vendor.openid), 'w4-conc-attempt-b', {
      plannedEndAtMs, expectedVendorVersion: 1,
    });
    const contextA = await session.issueLocationContext(identity(vendor.openid), 'w4-conc-ctx-a', {
      purpose: 'OPEN', targetId: attemptA.attemptId,
    });
    const contextB = await session.issueLocationContext(identity(vendor.openid), 'w4-conc-ctx-b', {
      purpose: 'OPEN', targetId: attemptB.attemptId,
    });
    const build = (attempt, context) => ({
      attemptId: attempt.attemptId,
      plannedEndAtMs,
      locationContextToken: context.locationContextToken,
      location: { ...location, locatedAtMs: context.issuedAtMs },
      expectedVendorVersion: 1,
    });
    const results = await Promise.allSettled([
      session.openSession(identity(vendor.openid), 'w4-conc-open-a', build(attemptA, contextA)),
      session.openSession(identity(vendor.openid), 'w4-conc-open-b', build(attemptB, contextB)),
    ]);
    const fulfilled = results.filter((item) => item.status === 'fulfilled');
    const rejected = results.filter((item) => item.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const [sessions] = await getPool().execute(
      'SELECT COUNT(*) AS total FROM cb_vendor_session WHERE vendor_id = ?', [vendor.vendorId],
    );
    const [days] = await getPool().execute(
      'SELECT COUNT(*) AS total FROM cb_vendor_open_day WHERE vendor_id = ?', [vendor.vendorId],
    );
    assert.equal(Number(sessions[0].total), 1);
    assert.equal(Number(days[0].total), 1);
  });

  test('本人停止结束轮次并隐藏坐标，恢复不清治理列', async () => {
    const vendor = await createVendor('w4-it-pub');
    const { opened } = await openVendor(vendor, { prefix: 'w4-pub' });
    const stopped = await session.stopSelfPublication(identity(vendor.openid), 'w4-pub-stop', {
      expectedSelfVersion: 1,
    });
    assert.ok(stopped.selfStoppedAtMs > 0);
    assert.equal(stopped.endedSessionId, opened.sessionId);
    assert.equal(stopped.selfVersion, 2);

    const workbench = await session.getWorkbench(identity(vendor.openid));
    assert.equal(workbench.phase, 'RESTING');
    assert.equal(workbench.currentLocation, undefined);
    assert.ok(workbench.profileEligibility.reasons.includes('SELF_STOPPED'));

    const me = await httpRequest('/me', { openid: vendor.openid });
    assert.ok(me.body.data.selfStoppedAtMs > 0);

    // 治理暂停：W7 起只经管理入口，管理员身份由部署名单同步。
    const adminLogin = await httpRequest('/me', { openid: 'w4-it-admin' });
    assert.equal(adminLogin.status, 200);
    const paused = await management.decideGovernance(identity('w4-it-admin'), String(vendor.vendorId), 'w4-pub-gov-pause', {
      action: 'PAUSE',
      reason: '现场核实',
      expectedGovernanceVersion: 1,
    });
    assert.ok(paused.governancePausedAtMs > 0);

    const resumed = await session.resumeSelfPublication(identity(vendor.openid), 'w4-pub-resume', {
      expectedSelfVersion: 2,
    });
    assert.equal(resumed.selfStoppedAtMs, undefined);
    assert.equal(resumed.governancePausedAtMs > 0, true);
    assert.ok(resumed.profileEligibility.reasons.includes('GOVERNANCE_PAUSED'));

    const restored = await management.decideGovernance(identity('w4-it-admin'), String(vendor.vendorId), 'w4-pub-gov-restore', {
      action: 'RESTORE',
      reason: '复核后解除',
      expectedGovernanceVersion: 2,
    });
    assert.equal(restored.governancePausedAtMs, undefined);
    const controls = await publication.getSelf(vendor.accountId);
    assert.equal(controls.selfStoppedAtMs, null);
    assert.equal(controls.governancePausedAtMs, null);
  });

  test('手动收摊回放同一终态，旧轮次 ID 不作用于新轮次', async () => {
    const vendor = await createVendor('w4-it-close');
    const { opened } = await openVendor(vendor, { prefix: 'w4-close' });
    const closed = await session.closeSession(identity(vendor.openid), opened.sessionId, 'w4-close-1', {
      expectedSessionVersion: 1,
    });
    assert.equal(closed.endReason, 'MANUAL');
    const replayed = await session.closeSession(identity(vendor.openid), opened.sessionId, 'w4-close-2', {
      expectedSessionVersion: 1,
    });
    assert.equal(replayed.endedAtMs, closed.endedAtMs);

    const { opened: second } = await openVendor(vendor, { prefix: 'w4-close-next' });
    // 旧轮次已终态：重试只回放它自己的终态（design §7.2），绝不作用于新轮次。
    const replayedOld = await session.closeSession(identity(vendor.openid), opened.sessionId, 'w4-close-old', {
      expectedSessionVersion: 2,
    });
    assert.equal(replayedOld.endReason, 'MANUAL');
    assert.equal(replayedOld.endedAtMs, closed.endedAtMs);
    const workbench = await session.getWorkbench(identity(vendor.openid));
    assert.equal(workbench.phase, 'OPEN');
    assert.equal(workbench.session.sessionId, second.sessionId);
    assert.ok(second.sessionId !== opened.sessionId);

    const [days] = await getPool().execute(
      'SELECT COUNT(*) AS total FROM cb_vendor_open_day WHERE vendor_id = ?', [vendor.vendorId],
    );
    assert.equal(Number(days[0].total), 1);
  });

  test('到期轮次按 E 派生休息、拒绝刷新，收摊返回 DEADLINE', async () => {
    const vendor = await createVendor('w4-it-deadline');
    const { opened } = await openVendor(vendor, { prefix: 'w4-deadline', offsetMs: 2 * HOUR });
    const [rows] = await getPool().execute(
      'SELECT started_at_ms FROM cb_vendor_session WHERE id = ?', [opened.sessionId],
    );
    const startedAtMs = Number(rows[0].started_at_ms);
    // 把轮次挪到「2 小时前开始、1 小时前到期」，让服务端主库时刻已越过 E。
    const plannedEndAtMs = startedAtMs - HOUR;
    await getPool().execute(
      'UPDATE cb_vendor_session SET started_at_ms = ?, planned_end_at_ms = ? WHERE id = ?',
      [startedAtMs - 2 * HOUR, plannedEndAtMs, opened.sessionId],
    );
    // 位置生效时刻跟随轮次一起前移，否则结束时刻早于生效时刻会触发 ck_location_stop。
    await getPool().execute(
      'UPDATE cb_session_location SET effective_at_ms = ? WHERE session_id = ?',
      [startedAtMs - 2 * HOUR, opened.sessionId],
    );

    const workbench = await session.getWorkbench(identity(vendor.openid));
    assert.equal(workbench.phase, 'RESTING');
    assert.equal(workbench.session.endedAtMs, plannedEndAtMs);
    assert.equal(workbench.session.endReason, 'DEADLINE');
    assert.equal(workbench.currentLocation, undefined);

    await assert.rejects(
      () => session.refreshLocation(identity(vendor.openid), opened.sessionId, 'w4-deadline-refresh', {
        locationContextToken: 'invalid-token-value',
        location: { ...location, locatedAtMs: Date.now() - 1000 },
        expectedSessionVersion: 1,
      }),
      (error) => error.bizCode === 'STATE_CONFLICT' || error.bizCode === 'VALIDATION_FAILED',
    );

    const closed = await session.closeSession(identity(vendor.openid), opened.sessionId, 'w4-deadline-close', {
      expectedSessionVersion: 1,
    });
    assert.equal(closed.endReason, 'DEADLINE');
    assert.equal(closed.endedAtMs, plannedEndAtMs);
  });

  test('同日两次开摊只计一天，出摊日分页返回总数', async () => {
    const vendor = await createVendor('w4-it-days');
    const first = await openVendor(vendor, { prefix: 'w4-days-1' });
    await session.closeSession(identity(vendor.openid), first.opened.sessionId, 'w4-days-close', {
      expectedSessionVersion: 1,
    });
    await openVendor(vendor, { prefix: 'w4-days-2' });

    const days = await session.listOpenDays(identity(vendor.openid), {});
    assert.equal(days.totalDays, 1);
    assert.equal(days.rows.length, 1);
    assert.equal(days.rows[0].sessionCount, 2);
    assert.ok(days.rows[0].lastEndedAtMs > 0);
    assert.equal(days.rows[0].openDate, first.opened.openDate);
  });
}

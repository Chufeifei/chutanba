const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

const isolatedDatabase = process.env.PHASE1_TEST_DATABASE;

if (!isolatedDatabase) {
  test('W3 integration requires PHASE1_TEST_* credentials', { skip: '未提供 phase1_test_w3 隔离库凭据' }, () => {});
} else {
  // 必须先覆盖 DB_* 再加载连接池：集成用例只认隔离库，绝不回退到应用库 chutanba。
  process.env.NODE_ENV = 'test';
  process.env.ALLOW_DEV_IDENTITY = 'true';
  process.env.DB_HOST = process.env.PHASE1_TEST_HOST || process.env.DB_HOST;
  process.env.DB_PORT = process.env.PHASE1_TEST_PORT || process.env.DB_PORT;
  process.env.DB_USER = process.env.PHASE1_TEST_USER;
  process.env.DB_PASSWORD = process.env.PHASE1_TEST_PASSWORD;
  process.env.DB_NAME = isolatedDatabase;
}

if (isolatedDatabase) {
  const env = require('../src/config/env');
  const app = require('../src/app');
  const { getPool, closeDatabase } = require('../src/db/pool');
  const { runPhase1Migrations } = require('../src/database/phase1/migration-runner');
  const account = require('../src/modules/account');
  const profile = require('../src/modules/profile');
  const auditModule = require('../src/modules/audit');

  const originalLists = { ...env.authorization };
  const identity = (openid) => ({ openid, unionid: null, userId: null, source: 'dev' });
  let server = null;
  let baseUrl = null;

  function validSubmission(expectedVendorVersion = 0, overrides = {}) {
    return {
      vendorName: '老王煎饼',
      categoryCode: 'PANCAKE',
      regularItemsText: '煎饼果子、豆浆',
      priceDescription: '煎饼 8 元起',
      announcement: '工作日早上六点出摊',
      expectedVendorVersion,
      ...overrides,
    };
  }

  function setReviewers(openids) {
    env.authorization.profileReviewerOpenids = Object.freeze(openids);
  }

  async function httpRequest(path, { method = 'GET', openid, body, key } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (openid) headers['X-Dev-Openid'] = openid;
    if (key) headers['Idempotency-Key'] = key;
    const response = await fetch(`${baseUrl}/api/v2${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }

  async function versionIdsForAccount(accountId) {
    const [rows] = await getPool().execute(
      `SELECT p.id FROM cb_vendor_profile_version p
       JOIN cb_vendor_identity v ON v.id = p.vendor_id WHERE v.account_id = ?`,
      [accountId],
    );
    return rows.map((row) => Number(row.id));
  }

  async function cleanupFixtures() {
    const pool = getPool();
    const [accounts] = await pool.execute("SELECT id FROM cb_user_account WHERE wx_openid LIKE 'w3-it-%'");
    for (const { id } of accounts) {
      const versionIds = await versionIdsForAccount(id);
      if (versionIds.length) {
        const marks = versionIds.map(() => '?').join(',');
        await pool.execute(`DELETE FROM cb_profile_review_event WHERE profile_version_id IN (${marks})`, versionIds);
        await pool.execute(
          `DELETE FROM cb_audit_event WHERE target_type = 'PROFILE_VERSION' AND target_id IN (${marks})`,
          versionIds,
        );
        await pool.execute(`DELETE FROM cb_vendor_profile_version WHERE id IN (${marks})`, versionIds);
      }
      await pool.execute('DELETE FROM cb_vendor_identity WHERE account_id = ?', [id]);
      await pool.execute('DELETE FROM cb_user_role WHERE account_id = ?', [id]);
      await pool.execute('DELETE FROM cb_admin_permission_grant WHERE account_id = ?', [id]);
      await pool.execute('DELETE FROM cb_admin_authorization_event WHERE target_account_id = ?', [id]);
      await pool.execute("DELETE FROM cb_audit_event WHERE target_type = 'ACCOUNT' AND target_id = ?", [id]);
      await pool.execute('DELETE FROM cb_idempotency_operation WHERE actor_scope = ?', [`account:${id}`]);
      await pool.execute('DELETE FROM cb_user_account WHERE id = ?', [id]);
    }
  }

  before(async () => {
    const result = await runPhase1Migrations(getPool());
    assert.ok(result.applied.length > 0 || result.skipped.length > 0);
    await cleanupFixtures();
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    env.authorization.superAdminOpenids = originalLists.superAdminOpenids;
    env.authorization.adminOpenids = originalLists.adminOpenids;
    env.authorization.profileReviewerOpenids = originalLists.profileReviewerOpenids;
    env.authorization.fieldReviewerOpenids = originalLists.fieldReviewerOpenids;
    if (server) await new Promise((resolve) => server.close(resolve));
    await cleanupFixtures();
    await closeDatabase();
  });

  test('HTTP layer enforces the idempotency key and exposes profile state', async () => {
    const owner = 'w3-it-http-owner';
    const reviewer = 'w3-it-http-reviewer';
    setReviewers([reviewer]);

    const missing = await httpRequest('/vendor/profile-submissions', {
      method: 'POST', openid: owner, body: validSubmission(),
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.bizCode, 'VALIDATION_FAILED');
    assert.ok(missing.body.data.fields.some((field) => field.field === 'Idempotency-Key'));

    const submitted = await httpRequest('/vendor/profile-submissions', {
      method: 'POST', openid: owner, key: 'w3-it-http-submit-1', body: validSubmission(),
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.data.reviewStatus, 'PENDING');
    const submissionId = submitted.body.data.submissionId;

    const mePending = await httpRequest('/me', { openid: owner });
    assert.equal(mePending.body.data.profileState, 'FIRST_PENDING');
    assert.equal(mePending.body.data.activeProfileVersionId, undefined);
    const selfPending = await httpRequest('/vendor/profile', { openid: owner });
    assert.equal(selfPending.body.data.profileState, 'FIRST_PENDING');

    const denied = await httpRequest(`/management/profile-reviews/${submissionId}/decision`, {
      method: 'POST', openid: owner, key: 'w3-it-http-deny',
      body: { decision: 'APPROVE', expectedTaskVersion: 1 },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.bizCode, 'PERMISSION_DENIED');

    await account.getMe(identity(reviewer));
    const queue = await httpRequest('/management/profile-reviews', { openid: reviewer });
    assert.equal(queue.status, 200);
    assert.equal(queue.body.data.rows.length, 1);
    assert.equal(queue.body.data.rows[0].submissionId, submissionId);
    assert.equal('regularItemsText' in queue.body.data.rows[0], false);

    const approved = await httpRequest(`/management/profile-reviews/${submissionId}/decision`, {
      method: 'POST', openid: reviewer, key: 'w3-it-http-approve',
      body: { decision: 'APPROVE', expectedTaskVersion: 1 },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.reviewStatus, 'APPROVED');

    const meActive = await httpRequest('/me', { openid: owner });
    assert.equal(meActive.body.data.profileState, 'ACTIVE');
    assert.equal(meActive.body.data.activeProfileVersionId, submissionId);
  });

  test('first submission creates one vendor and stays non-public until approval', async () => {
    const owner = 'w3-it-life';
    const first = await profile.submit(identity(owner), 'w3-it-life-submit-1', validSubmission(0));
    assert.equal(first.reviewStatus, 'PENDING');
    assert.equal(first.stateVersion, 2);

    const [vendors] = await getPool().execute(
      `SELECT id, vendor_code, active_profile_version_id FROM cb_vendor_identity
       WHERE account_id = (SELECT id FROM cb_user_account WHERE wx_openid = ?)`,
      [owner],
    );
    assert.equal(vendors.length, 1);
    assert.match(String(vendors[0].vendor_code), /^V\d{12}$/);
    assert.equal(vendors[0].active_profile_version_id, null);

    const state = await profile.getSelfProfile(identity(owner));
    assert.equal(state.profileState, 'FIRST_PENDING');
    assert.equal(state.activeProfile, undefined);

    await assert.rejects(
      () => profile.submit(identity(owner), 'w3-it-life-submit-2', validSubmission(first.stateVersion)),
      (error) => error.bizCode === 'STATE_CONFLICT' && error.data.resource === 'profileSubmission',
    );
    await assert.rejects(
      () => profile.submit(identity(owner), 'w3-it-life-submit-3', validSubmission(0)),
      (error) => error.bizCode === 'STATE_CONFLICT' && error.data.resource === 'vendor',
    );

    const own = await profile.getOwnSubmission(identity(owner), first.submissionId);
    assert.equal(own.reviewStatus, 'PENDING');
    assert.equal(own.activeProfileVersionId, undefined);
    await assert.rejects(
      () => profile.getOwnSubmission(identity('w3-it-life-other'), first.submissionId),
      (error) => error.bizCode === 'RESOURCE_NOT_FOUND',
    );
  });

  test('first rejection keeps no active pointer and exposes the reason only to the owner', async () => {
    const owner = 'w3-it-reject';
    const reviewer = 'w3-it-reviewer';
    setReviewers([reviewer]);
    await account.getMe(identity(reviewer));
    const first = await profile.submit(identity(owner), 'w3-it-reject-s1', validSubmission(0));
    const rejected = await profile.decide(identity(reviewer), first.submissionId, 'w3-it-reject-d1', {
      decision: 'REJECT', reason: '公告信息不足', expectedTaskVersion: 1,
    });
    assert.equal(rejected.reviewStatus, 'REJECTED');
    const state = await profile.getSelfProfile(identity(owner));
    assert.equal(state.profileState, 'FIRST_REJECTED');
    assert.equal(state.activeProfile, undefined);
    assert.equal(state.latestDecision.reason, '公告信息不足');
    const own = await profile.getOwnSubmission(identity(owner), first.submissionId);
    assert.equal(own.decisionReason, '公告信息不足');

    const second = await profile.submit(identity(owner), 'w3-it-reject-s2', validSubmission(state.stateVersion));
    assert.equal(second.versionNo, 2);
    assert.equal((await profile.getSelfProfile(identity(owner))).profileState, 'FIRST_PENDING');
  });

  test('approved update switches the pointer and a rejection keeps the old content', async () => {
    const owner = 'w3-it-update';
    const reviewer = 'w3-it-reviewer';
    setReviewers([reviewer]);
    await account.getMe(identity(reviewer));

    const initial = await profile.submit(identity(owner), 'w3-it-update-s1', validSubmission(0));
    await profile.decide(identity(reviewer), initial.submissionId, 'w3-it-update-d1', {
      decision: 'APPROVE', expectedTaskVersion: 1,
    });
    const activeState = await profile.getSelfProfile(identity(owner));
    assert.equal(activeState.profileState, 'ACTIVE');
    assert.equal(activeState.activeProfile.vendorName, '老王煎饼');
    const activeId = activeState.activeProfile.versionId;

    const update = await profile.submit(identity(owner), 'w3-it-update-s2',
      validSubmission(activeState.stateVersion, { vendorName: '老王煎饼二店' }));
    assert.equal((await profile.getSelfProfile(identity(owner))).profileState, 'UPDATE_PENDING');
    await profile.decide(identity(reviewer), update.submissionId, 'w3-it-update-d2', {
      decision: 'REJECT', reason: '名称与现场不符', expectedTaskVersion: 1,
    });

    const afterReject = await profile.getSelfProfile(identity(owner));
    assert.equal(afterReject.profileState, 'UPDATE_REJECTED');
    assert.equal(afterReject.activeProfile.versionId, activeId);
    assert.equal(afterReject.activeProfile.vendorName, '老王煎饼');

    const update2 = await profile.submit(identity(owner), 'w3-it-update-s3',
      validSubmission(afterReject.stateVersion, { vendorName: '老王煎饼二店' }));
    await profile.decide(identity(reviewer), update2.submissionId, 'w3-it-update-d3', {
      decision: 'APPROVE', expectedTaskVersion: 1,
    });
    const final = await profile.getSelfProfile(identity(owner));
    assert.equal(final.profileState, 'ACTIVE');
    assert.equal(final.activeProfile.vendorName, '老王煎饼二店');
    assert.ok(final.stateVersion > afterReject.stateVersion);
  });

  test('concurrent reviewers leave exactly one terminal event', async () => {
    const owner = 'w3-it-race';
    setReviewers(['w3-it-race-a', 'w3-it-race-b']);
    await account.getMe(identity('w3-it-race-a'));
    await account.getMe(identity('w3-it-race-b'));
    const submission = await profile.submit(identity(owner), 'w3-it-race-s1', validSubmission(0));
    const results = await Promise.allSettled([
      profile.decide(identity('w3-it-race-a'), submission.submissionId, 'w3-it-race-d1', {
        decision: 'APPROVE', expectedTaskVersion: 1,
      }),
      profile.decide(identity('w3-it-race-b'), submission.submissionId, 'w3-it-race-d2', {
        decision: 'APPROVE', expectedTaskVersion: 1,
      }),
    ]);
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    const rejected = results.find((item) => item.status === 'rejected');
    assert.equal(rejected.reason.bizCode, 'STATE_CONFLICT');
    const [rows] = await getPool().execute(
      'SELECT COUNT(*) AS count FROM cb_profile_review_event WHERE profile_version_id = ?',
      [Number(submission.submissionId)],
    );
    assert.equal(Number(rows[0].count), 1);
  });

  test('INVALIDATED applications cannot be approved again', async () => {
    const owner = 'w3-it-invalid';
    const reviewer = 'w3-it-reviewer';
    setReviewers([reviewer]);
    await account.getMe(identity(reviewer));
    const submission = await profile.submit(identity(owner), 'w3-it-invalid-s1', validSubmission(0));
    await getPool().execute(
      `UPDATE cb_vendor_profile_version
       SET review_status = 'INVALIDATED', decided_at_ms = 1, state_version = state_version + 1
       WHERE id = ?`,
      [Number(submission.submissionId)],
    );
    await assert.rejects(
      () => profile.decide(identity(reviewer), submission.submissionId, 'w3-it-invalid-d1', {
        decision: 'APPROVE', expectedTaskVersion: 1,
      }),
      (error) => error.bizCode === 'ALREADY_PROCESSED' && error.data.resource === 'profileReview',
    );
  });

  test('same key replays the first result and a different body mismatches', async () => {
    const owner = 'w3-it-idem';
    const first = await profile.submit(identity(owner), 'w3-it-idem-k1', validSubmission(0));
    const replay = await profile.submit(identity(owner), 'w3-it-idem-k1', validSubmission(0));
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.submissionId, first.submissionId);
    assert.equal(replay.stateVersion, first.stateVersion);
    await assert.rejects(
      () => profile.submit(identity(owner), 'w3-it-idem-k1', validSubmission(0, { vendorName: '另一家' })),
      (error) => error.bizCode === 'IDEMPOTENCY_MISMATCH',
    );
  });

  test('management queue pages by cursor, hides body in the list and re-checks permission', async () => {
    const reviewer = 'w3-it-list-reviewer';
    const owners = ['w3-it-list-a', 'w3-it-list-b'];
    setReviewers([reviewer]);
    await account.getMe(identity(reviewer));
    const submissions = [];
    for (const [index, owner] of owners.entries()) {
      submissions.push(await profile.submit(identity(owner), `w3-it-list-s${index}`, validSubmission(0)));
    }

    await assert.rejects(
      () => profile.listReviews(identity('w3-it-list-peer'), {}),
      (error) => error.bizCode === 'PERMISSION_DENIED',
    );
    const firstPage = await profile.listReviews(identity(reviewer), { status: 'PENDING', limit: '1' });
    assert.equal(firstPage.rows.length, 1);
    assert.equal('regularItemsText' in firstPage.rows[0], false);
    assert.ok(firstPage.nextCursor);
    const secondPage = await profile.listReviews(identity(reviewer), {
      status: 'PENDING', limit: '1', cursor: firstPage.nextCursor,
    });
    assert.equal(secondPage.rows.length, 1);
    assert.notEqual(secondPage.rows[0].submissionId, firstPage.rows[0].submissionId);
    await assert.rejects(
      () => profile.listReviews(identity(reviewer), { status: 'APPROVED', cursor: firstPage.nextCursor }),
      (error) => error.bizCode === 'VALIDATION_FAILED',
    );

    const detail = await profile.getReview(identity(reviewer), submissions[0].submissionId);
    assert.equal(detail.regularItemsText, '煎饼果子、豆浆');
    assert.equal(detail.kind, 'FIRST');
    assert.equal(detail.reviewHistory.length, 0);
    await assert.rejects(
      () => profile.getReview(identity('w3-it-list-peer'), submissions[0].submissionId),
      (error) => error.bizCode === 'PERMISSION_DENIED',
    );
  });

  test('revoked reviewer permission is rejected on the next request', async () => {
    const reviewer = 'w3-it-revoke';
    setReviewers([reviewer]);
    await account.getMe(identity(reviewer));
    const submission = await profile.submit(identity('w3-it-revoke-owner'), 'w3-it-revoke-s1',
      validSubmission(0));
    setReviewers([]);
    await account.getMe(identity(reviewer));
    await assert.rejects(
      () => profile.decide(identity(reviewer), submission.submissionId, 'w3-it-revoke-d1', {
        decision: 'APPROVE', expectedTaskVersion: 1,
      }),
      (error) => error.bizCode === 'PERMISSION_DENIED',
    );
  });

  test('audit failure rolls back the submission transaction', async () => {
    const owner = 'w3-it-audit';
    const original = auditModule.record;
    auditModule.record = async () => { throw new Error('audit unavailable'); };
    try {
      await assert.rejects(
        () => profile.submit(identity(owner), 'w3-it-audit-k1', validSubmission(0)),
        (error) => error.message === 'audit unavailable',
      );
    } finally {
      auditModule.record = original;
    }
    const [rows] = await getPool().execute(
      `SELECT COUNT(*) AS count FROM cb_vendor_identity
       WHERE account_id = (SELECT id FROM cb_user_account WHERE wx_openid = ?)`,
      [owner],
    );
    assert.equal(Number(rows[0].count), 0);
  });
}

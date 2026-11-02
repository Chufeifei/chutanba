const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');

const isolatedDatabase = process.env.PHASE1_TEST_DATABASE;

if (!isolatedDatabase) {
  test('W2 integration requires PHASE1_TEST_* credentials', { skip: '未提供 phase1_test_w2 隔离库凭据' }, () => {});
} else {
  // 必须先覆盖 DB_* 再加载连接池：集成用例只认隔离库，绝不回退到应用库 chutanba。
  process.env.DB_HOST = process.env.PHASE1_TEST_HOST || process.env.DB_HOST;
  process.env.DB_PORT = process.env.PHASE1_TEST_PORT || process.env.DB_PORT;
  process.env.DB_USER = process.env.PHASE1_TEST_USER;
  process.env.DB_PASSWORD = process.env.PHASE1_TEST_PASSWORD;
  process.env.DB_NAME = isolatedDatabase;
}

if (isolatedDatabase) {
  const env = require('../src/config/env');
  const { getPool, closeDatabase } = require('../src/db/pool');
  const { withTransaction } = require('../src/db/transaction');
  const { runPhase1Migrations } = require('../src/database/phase1/migration-runner');
  const account = require('../src/modules/account');
  const operation = require('../src/modules/operation');
  const audit = require('../src/modules/audit');
  const accountRepository = require('../src/modules/account/repository');
  const operationRepository = require('../src/modules/operation/repository');
  const { sha256Hex } = require('../src/utils/digest');

  const originalLists = { ...env.authorization };
  const identity = (openid) => ({ openid, unionid: null, userId: null, source: 'dev' });

  async function countAccounts(openid) {
    const [rows] = await getPool().execute(
      'SELECT COUNT(*) AS count FROM cb_user_account WHERE wx_openid = ?',
      [openid],
    );
    return Number(rows[0].count);
  }

  async function cleanupFixtures() {
    const pool = getPool();
    const [accounts] = await pool.execute("SELECT id FROM cb_user_account WHERE wx_openid LIKE 'w2-it-%'");
    for (const { id } of accounts) {
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
  });

  after(async () => {
    env.authorization.superAdminOpenids = originalLists.superAdminOpenids;
    env.authorization.adminOpenids = originalLists.adminOpenids;
    env.authorization.profileReviewerOpenids = originalLists.profileReviewerOpenids;
    env.authorization.fieldReviewerOpenids = originalLists.fieldReviewerOpenids;
    await cleanupFixtures();
    await closeDatabase();
  });

  test('W2 migrations seed both reviewer permissions', async () => {
    const [rows] = await getPool().execute(
      `SELECT COUNT(*) AS count FROM cb_admin_permission
       WHERE permission_code IN ('PROFILE_REVIEWER','FIELD_REVIEWER') AND grantable_to_admin = 0`,
    );
    assert.equal(Number(rows[0].count), 2);
  });

  test('concurrent first access creates exactly one account', async () => {
    const openid = 'w2-it-concurrent';
    const results = await Promise.all([account.getMe(identity(openid)), account.getMe(identity(openid))]);
    assert.equal(await countAccounts(openid), 1);
    assert.equal(results[0].accountId, results[1].accountId);
  });

  test('deployment lists drive capabilities and revocation is immediate', async () => {
    const openid = 'w2-it-admin';
    env.authorization.superAdminOpenids = Object.freeze([openid]);
    env.authorization.profileReviewerOpenids = Object.freeze([openid]);
    const me = await account.getMe(identity(openid));
    assert.deepEqual(me.capabilities, ['SUPER_ADMIN', 'PROFILE_REVIEWER']);
    assert.equal('openid' in me, false);
    assert.equal(me.vendorId, undefined);
    env.authorization.superAdminOpenids = Object.freeze([]);
    env.authorization.profileReviewerOpenids = Object.freeze([]);
    assert.deepEqual((await account.getMe(identity(openid))).capabilities, []);
  });

  test('idempotent command replays success, rejects body changes and hides other scopes', async () => {
    const owner = await account.getMe(identity('w2-it-op-a'));
    const other = await account.getMe(identity('w2-it-op-b'));
    const actorScope = `account:${owner.accountId}`;
    const request = { b: 2, a: 1 };
    const execute = async (connection) => {
      await audit.record(connection, {
        actionCode: 'W2_IT_EXECUTE', actorAccountId: Number(owner.accountId), targetType: 'ACCOUNT',
        targetId: Number(owner.accountId), occurredAtMs: 1, resultCode: 'SUCCESS', retentionClass: 'GENERAL',
      });
      return { resultRef: 'w2-it-result' };
    };
    const reload = async (resultRef) => ({ resultRef });
    const first = await operation.executeIdempotent({
      actorScope, operationType: 'PROFILE_SUBMIT', key: 'w2-it-key-1', request, execute, reload,
    });
    assert.equal(first.replayed, false);
    const second = await operation.executeIdempotent({
      actorScope, operationType: 'PROFILE_SUBMIT', key: 'w2-it-key-1', request: { a: 1, b: 2 }, execute, reload,
    });
    assert.equal(second.replayed, true);
    assert.deepEqual(second.result, { resultRef: 'w2-it-result' });
    await assert.rejects(
      () => operation.executeIdempotent({
        actorScope, operationType: 'PROFILE_SUBMIT', key: 'w2-it-key-1', request: { a: 9 }, execute, reload,
      }),
      (error) => error.bizCode === 'IDEMPOTENCY_MISMATCH',
    );
    assert.equal((await operation.getOperationStatus(actorScope, 'PROFILE_SUBMIT', 'w2-it-key-1')).status, 'SUCCEEDED');
    await assert.rejects(
      () => operation.getOperationStatus(`account:${other.accountId}`, 'PROFILE_SUBMIT', 'w2-it-key-1'),
      (error) => error.bizCode === 'RESOURCE_NOT_FOUND',
    );
  });

  test('a reserved but unfinished operation reports PROCESSING', async () => {
    const owner = await account.getMe(identity('w2-it-op-pending'));
    const key = 'w2-it-pending-key';
    const keyHash = sha256Hex(key);
    await withTransaction((connection) => operationRepository.insertPending(connection, {
      actorScope: `account:${owner.accountId}`,
      operationType: 'PROFILE_SUBMIT',
      keyHash,
      requestHash: '1'.repeat(64),
      nowMs: 1,
    }));
    const status = await operation.getOperationStatus(
      `account:${owner.accountId}`, 'PROFILE_SUBMIT', key,
    );
    assert.equal(status.status, 'PROCESSING');
  });

  test('audit insertion failure rolls back the business write', async () => {
    const openid = 'w2-it-rollback';
    await assert.rejects(
      () => withTransaction(async (connection) => {
        const accountId = await accountRepository.insertAccount(connection, {
          openid, unionid: null, nowMs: 1,
        });
        await audit.record(connection, {
          actionCode: 'W2_IT_ROLLBACK', targetType: 'ACCOUNT', targetId: accountId,
          occurredAtMs: 1, resultCode: 'SUCCESS', retentionClass: 'GENERAL',
          reasonSummary: 'x'.repeat(501),
        });
      }),
      (error) => error.bizCode === 'VALIDATION_FAILED',
    );
    assert.equal(await countAccounts(openid), 0);
  });
}

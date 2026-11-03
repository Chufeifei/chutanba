/**
 * 本地演示数据：在指定库写入若干「顾客可见」的摊位，用于 W9 页面联调与手工点测。
 *
 * 为什么需要：一期数据结构强约束（生效资料 + 当前轮次 + 有效位置 + 无两类限制），
 * 手写 SQL 容易漏条件导致列表空、详情 UNVIEWABLE，排查成本高。本脚本按 §4 资格谓词
 * 逐条构造，保证写出来的对象一定落在公开集合内。
 *
 * 使用：
 *   DB_NAME=chutanba_app node scripts/seed-demo-public-vendors.js
 *   DB_NAME=chutanba_app node scripts/seed-demo-public-vendors.js --reset   # 先清掉上一次的演示数据
 *
 * 护栏：
 *   1. 拒绝在 DB_NAME=chutanba 上执行（那是应用库，演示数据不得混入）；
 *   2. 只删除 vendor_code 以 DEMO 开头的对象，不动其他数据；
 *   3. 重复执行按 vendor_code 幂等：已存在则跳过。
 */
const env = require('../src/config/env');
const { getPool, closeDatabase } = require('../src/db/pool');
const account = require('../src/modules/account');

const MINUTE = 60_000;

// 演示对象：两个营业中（不同品类、不同距离）、一个准备收摊（触发导航二次确认）、一个已收摊。
const DEMO_VENDORS = [
  {
    code: 'DEMO0001',
    openid: 'demo-open-korean',
    name: '老张烤冷面',
    categoryCode: 'SNACK',
    regularItems: '烤冷面、鸡蛋灌饼、豆浆',
    price: '8-15 元',
    announcement: '今天在人民广场地铁 2 号口，卖完收摊',
    lat: 31.2304,
    lng: 121.4737,
    locationName: '人民广场地铁 2 号口',
    mode: 'OPEN',
  },
  {
    code: 'DEMO0002',
    openid: 'demo-open-tea',
    name: '阿May手打柠檬茶',
    categoryCode: 'DRINK',
    regularItems: '手打柠檬茶、鸭屎香柠檬茶',
    price: '12-18 元',
    announcement: '新客第二杯半价',
    lat: 31.2352,
    lng: 121.4805,
    locationName: '南京东路步行街东段',
    mode: 'OPEN',
  },
  {
    code: 'DEMO0003',
    openid: 'demo-preparing-oden',
    name: '深夜关东煮',
    categoryCode: 'SNACK',
    regularItems: '关东煮、鱼豆腐、萝卜',
    price: '3-20 元',
    announcement: '预计 8 分钟后收摊',
    lat: 31.2268,
    lng: 121.4692,
    locationName: '西藏中路便利店门口',
    mode: 'PREPARING',
  },
  {
    code: 'DEMO0004',
    openid: 'demo-resting-pancake',
    name: '王阿姨煎饼摊',
    categoryCode: 'BREAKFAST',
    regularItems: '煎饼果子、豆腐脑',
    price: '6-12 元',
    announcement: '今日已收摊，明天早上 6 点见',
    lat: 31.2331,
    lng: 121.4701,
    locationName: '黄陂北路路口',
    mode: 'RESTING',
  },
];

function assertSafeDatabase() {
  const name = env.database.name;
  if (!name) throw new Error('DB_NAME 未配置，拒绝写入');
  if (name === 'chutanba') throw new Error('拒绝在应用库 chutanba 上写入演示数据');
  const isTestBed = /^(chutanba_app|phase1_test_|.*_local$)/.test(name);
  if (!isTestBed) throw new Error(`库名 ${name} 不在允许清单内（chutanba_app / phase1_test_* / *_local）`);
}

async function resetDemoData(pool) {
  const [vendors] = await pool.execute("SELECT id FROM cb_vendor_identity WHERE vendor_code LIKE 'DEMO%'");
  for (const { id: vendorId } of vendors) {
    await pool.execute(
      `DELETE FROM cb_navigation_check WHERE observation_id IN
         (SELECT id FROM cb_feedback_observation WHERE vendor_id = ?)`,
      [vendorId],
    );
    await pool.execute('DELETE FROM cb_feedback_observation WHERE vendor_id = ?', [vendorId]);
    await pool.execute('DELETE FROM cb_session_location WHERE vendor_id = ?', [vendorId]);
    await pool.execute('DELETE FROM cb_vendor_session WHERE vendor_id = ?', [vendorId]);
    // 管理处理与影响记录同样属于演示对象：重置后不应留下指向已删摊主的孤儿行。
    await pool.execute('DELETE FROM cb_management_action WHERE vendor_id = ?', [vendorId]);
    await pool.execute('DELETE FROM cb_vendor_impact_record WHERE vendor_id = ?', [vendorId]);
    await pool.execute('DELETE FROM cb_vendor_open_day WHERE vendor_id = ?', [vendorId]);
    await pool.execute('DELETE FROM cb_vendor_publication_control WHERE vendor_id = ?', [vendorId]);
    await pool.execute('DELETE FROM cb_vendor_profile_version WHERE vendor_id = ?', [vendorId]);
    await pool.execute('DELETE FROM cb_vendor_identity WHERE id = ?', [vendorId]);
  }
  const [accounts] = await pool.execute("SELECT id FROM cb_user_account WHERE wx_openid LIKE 'demo-%'");
  for (const { id } of accounts) {
    await pool.execute('DELETE FROM cb_location_context WHERE account_id = ?', [id]);
    await pool.execute('DELETE FROM cb_user_account WHERE id = ?', [id]);
  }
  return vendors.length;
}

async function seedVendor(pool, spec) {
  const [existing] = await pool.execute('SELECT id FROM cb_vendor_identity WHERE vendor_code = ?', [spec.code]);
  if (existing.length > 0) return { vendorId: Number(existing[0].id), skipped: true };

  const now = Date.now();
  const actor = await account.resolveAccount({ openid: spec.openid, unionid: null, userId: null, source: 'dev' });

  const [vendorResult] = await pool.execute(
    `INSERT INTO cb_vendor_identity
       (account_id, vendor_code, lifecycle_status, active_profile_version_id, state_version, created_at_ms, updated_at_ms)
     VALUES (?, ?, 'ACTIVE', NULL, 1, ?, ?)`,
    [actor.id, spec.code, now, now],
  );
  const vendorId = Number(vendorResult.insertId);

  const [profileResult] = await pool.execute(
    `INSERT INTO cb_vendor_profile_version
       (vendor_id, version_no, vendor_name, category_code, regular_items_text,
        price_description, announcement, review_status, submitted_at_ms, decided_at_ms)
     VALUES (?, 1, ?, ?, ?, ?, ?, 'APPROVED', ?, ?)`,
    [vendorId, spec.name, spec.categoryCode, spec.regularItems, spec.price, spec.announcement, now, now],
  );
  const profileId = Number(profileResult.insertId);
  await pool.execute('UPDATE cb_vendor_identity SET active_profile_version_id = ? WHERE id = ?', [
    profileId, vendorId,
  ]);

  // 三个非 RESTING 的演示对象都在计划营业窗口内；RESTING 用「已结束轮次」表达，
  // 与 qualification 谓词一致：轮次存在但 ended_at_ms 已写，公开详情只给休息投影。
  const resting = spec.mode === 'RESTING';
  const preparing = spec.mode === 'PREPARING';
  const started = now - (resting || preparing ? 100 : 10) * MINUTE;
  const planned = now + (preparing ? 8 : resting ? -10 : 110) * MINUTE;
  const ended = resting ? planned : null;

  const [sessionResult] = await pool.execute(
    `INSERT INTO cb_vendor_session
       (vendor_id, profile_version_id, started_at_ms, planned_end_at_ms, ended_at_ms, end_reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [vendorId, profileId, started, planned, ended, ended === null ? null : 'MANUAL'],
  );
  const sessionId = Number(sessionResult.insertId);

  await pool.execute(
    `INSERT INTO cb_session_location
       (session_id, vendor_id, version_no, lat, lng, location_name, located_at_ms, effective_at_ms)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
    [sessionId, vendorId, spec.lat, spec.lng, spec.locationName, now, started],
  );

  // 与生产写入保持一致：未结束的轮次必须同时成为摊主当前指针，否则治理暂停与管理上下文
  // 会按「无在途轮次」处理，出现「可开摊=true 却仍在公开集合」的自相矛盾演示数据。
  await pool.execute('UPDATE cb_vendor_identity SET current_session_id = ? WHERE id = ?', [
    resting ? null : sessionId, vendorId,
  ]);

  return { vendorId, skipped: false };
}

async function main() {
  assertSafeDatabase();
  const reset = process.argv.includes('--reset');
  const pool = getPool();

  if (reset) {
    const removed = await resetDemoData(pool);
    console.log(`已清理上次演示对象：${removed} 个摊位`);
  }

  for (const spec of DEMO_VENDORS) {
    const result = await seedVendor(pool, spec);
    console.log(`${result.skipped ? '已存在跳过' : '已写入'} ${spec.code} ${spec.name} (${spec.categoryCode}/${spec.mode}) vendorId=${result.vendorId}`);
  }

  console.log(`\n库：${env.database.name}`);
  console.log('预期公开集合：DEMO0001、DEMO0002、DEMO0003（DEMO0004 为已收摊，只在详情可见休息态）');
}

main()
  .then(() => closeDatabase())
  .catch(async (error) => {
    console.error('种子写入失败：', error.message);
    await closeDatabase();
    process.exitCode = 1;
  });

/**
 * 补齐摊主公开位置的「最后一次成功营业定位时刻」。
 *
 * 背景：0002 建表时遗漏该列，而写入路径已按BR-LOC-03 以此列为公开期起算基准，
 * 导致位置发布在真实库必然报 ER_BAD_FIELD_ERROR。0002 已被 checksum 锁定不可改写，
 * 故以增量迁移补列。
 *
 * 语义：RECENT_LAST 的 public_until_ms 由此列推导，CURRENT_NAVIGATION 持续有效不用它；
 * 落库后公开期起点可审计，不再只能靠 published_at_ms 近似推断。
 *
 * 绝对时刻统一为 UTC 毫秒 BIGINT UNSIGNED（vnext 数据库设计基线），不建物理外键。
 */
const statements = [
  `ALTER TABLE cb_vendor_locations
     ADD COLUMN last_located_at_ms BIGINT UNSIGNED NULL AFTER published_at_ms`,
  // 历史行回填：以发布时间近似定位时刻，使既有 RECENT_LAST 行的公开期可继续推导。
  // 仅回填 NULL 行，重复执行不覆盖已有值。
  `UPDATE cb_vendor_locations
     SET last_located_at_ms = published_at_ms
     WHERE last_located_at_ms IS NULL`,
];

module.exports = { description: '为 cb_vendor_locations 补齐 last_located_at_ms 列', statements };
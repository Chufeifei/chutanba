/**
 * 摊主公开位置表。每个摊主最多保留一条当前公开位置：
 * 出摊中为当前导航地址（CURRENT_NAVIGATION），休息中或请假中为最近出摊位置（RECENT_LAST）。
 *
 * 公开截止时刻 public_until_ms 为左闭右开区间的右端点（不含该时刻），
 * 由最后一次成功营业定位时刻起第 7 日相同本地时刻（平台业务时区 Asia/Shanghai）计算。
 * 位置历史不建轨迹列；停止公开或到期后的历史仅在受限审计权限内保留。
 *
 * 不建物理外键（遵循 vnext 数据库设计基线）；关联列保留索引。
 */
const statements = [
  `CREATE TABLE IF NOT EXISTS cb_vendor_locations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    vendor_id BIGINT UNSIGNED NOT NULL,
    location_kind VARCHAR(32) NOT NULL,
    lat DECIMAL(10,7) NOT NULL,
    lng DECIMAL(11,7) NOT NULL,
    location_name VARCHAR(255) NOT NULL,
    region_id BIGINT UNSIGNED NULL,
    public_until_ms BIGINT UNSIGNED NOT NULL,
    public_status VARCHAR(16) NOT NULL DEFAULT 'PUBLIC',
    published_at_ms BIGINT UNSIGNED NOT NULL,
    stopped_at_ms BIGINT UNSIGNED NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    active_vendor_id BIGINT UNSIGNED GENERATED ALWAYS AS (
      CASE WHEN public_status = 'PUBLIC' THEN vendor_id ELSE NULL END
    ) STORED,
    KEY idx_cb_vendor_locations_vendor (vendor_id, public_status),
    KEY idx_cb_vendor_locations_region (region_id, public_status),
    KEY idx_cb_vendor_locations_until (public_status, public_until_ms),
    UNIQUE KEY uk_cb_vendor_locations_active (active_vendor_id),
    CONSTRAINT chk_cb_vendor_locations_kind CHECK (location_kind IN ('CURRENT_NAVIGATION', 'RECENT_LAST')),
    CONSTRAINT chk_cb_vendor_locations_status CHECK (public_status IN ('PUBLIC', 'SUPERSEDED', 'STOPPED', 'EXPIRED')),
    CONSTRAINT chk_cb_vendor_locations_lat CHECK (lat >= -90 AND lat <= 90),
    CONSTRAINT chk_cb_vendor_locations_lng CHECK (lng >= -180 AND lng <= 180)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
];

module.exports = { description: '建立摊主公开位置表 cb_vendor_locations', statements };

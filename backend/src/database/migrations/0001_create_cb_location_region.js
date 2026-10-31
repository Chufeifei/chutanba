/**
 * 区域字典表。区域是平台自定义的经营片区（中心点 + 覆盖半径），
 * 不是行政区划；由运营在管理端维护，停用不物理删除以保留历史归属审计。
 *
 * 不建物理外键（遵循 vnext 数据库设计基线）；关联列保留索引。
 * 坐标只用 DECIMAL，禁止 FLOAT/DOUBLE。
 */
const statements = [
  `CREATE TABLE IF NOT EXISTS cb_location_region (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    region_code VARCHAR(64) NOT NULL,
    region_name VARCHAR(128) NOT NULL,
    city_code VARCHAR(32) NOT NULL,
    center_lat DECIMAL(10,7) NOT NULL,
    center_lng DECIMAL(11,7) NOT NULL,
    radius_m INT UNSIGNED NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ENABLED',
    sort_order INT NOT NULL DEFAULT 0,
    idempotency_key VARCHAR(128) NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    updated_at_ms BIGINT UNSIGNED NOT NULL,
    UNIQUE KEY uk_cb_location_region_code (region_code),
    KEY idx_cb_location_region_status (status, sort_order),
    KEY idx_cb_location_region_idempotency (idempotency_key),
    CONSTRAINT chk_cb_location_region_status CHECK (status IN ('ENABLED', 'DISABLED')),
    CONSTRAINT chk_cb_location_region_lat CHECK (center_lat >= -90 AND center_lat <= 90),
    CONSTRAINT chk_cb_location_region_lng CHECK (center_lng >= -180 AND center_lng <= 180),
    CONSTRAINT chk_cb_location_region_radius CHECK (radius_m > 0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
];

module.exports = { description: '建立区域字典表 cb_location_region', statements };

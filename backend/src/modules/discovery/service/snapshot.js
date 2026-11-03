/**
 * 公开集合（列表与地图同源）：一次读取产出唯一 items 与 snapshotVersion。
 * 主库时刻来自 SELECT NOW(3)，与营业工作台同源；不使用应用进程时钟。
 * 集合超过 PUBLIC_SNAPSHOT_MAX 时明确失败，绝不截断后冒充完整集合。
 */
const { withTransaction } = require('../../../db/transaction');
const env = require('../../../config/env');
const { DomainError } = require('../../../domain/errors');
const { sha256Hex } = require('../../../utils/digest');
const session = require('../../session');
const repository = require('../repository');
const mapper = require('../mapper');
const { parseSearchInput } = require('../schema');

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(origin, lat, lng) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat - origin.lat);
  const dLng = toRad(lng - origin.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(origin.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function roundDistance(value) {
  return Math.round(value * 10) / 10;
}

function phaseOf(row, nowMs) {
  return session.deriveSessionPhase({
    nowMs,
    startedAtMs: Number(row.started_at_ms),
    plannedEndAtMs: Number(row.planned_end_at_ms),
  });
}

function orderByDistance(rows, viewerLocation) {
  const measured = rows.map((row) => ({
    row,
    distance: haversineMeters(viewerLocation, Number(row.lat), Number(row.lng)),
  }));
  measured.sort((left, right) => {
    if (left.distance !== right.distance) return left.distance - right.distance;
    return BigInt(left.row.vendor_id) < BigInt(right.row.vendor_id) ? -1 : 1;
  });
  return measured;
}

function snapshotVersionOf(rows) {
  const parts = rows
    .map((row) => `${row.vendor_id}:${row.session_id}:${row.location_id}`)
    .sort()
    .join('|');
  return sha256Hex(parts).slice(0, 16);
}

function buildResponse(rows, nowMs, viewerLocation) {
  const ordered = viewerLocation
    ? orderByDistance(rows, viewerLocation)
    : rows.map((row) => ({ row, distance: null }));
  const items = ordered.map(({ row, distance }) => {
    const phaseInfo = phaseOf(row, nowMs);
    const options = { phase: phaseInfo.phase };
    if (distance !== null) options.distanceM = roundDistance(distance);
    return mapper.toPublicListItem(row, options);
  });
  return {
    snapshotVersion: snapshotVersionOf(rows),
    serverNowMs: nowMs,
    items,
  };
}

async function searchPublicVendors(input) {
  const parsed = parseSearchInput(input);
  const max = env.publicTokens.snapshotMax;
  return withTransaction(async (connection) => {
    const now = await repository.readNowMs(connection);
    const total = await repository.countPublicRows(connection, {
      categoryCode: parsed.categoryCode,
      nowMs: now,
    });
    if (total > max) {
      console.error(`公开集合规模 ${total} 超出上限 ${max}，拒绝返回部分集合`);
      throw new DomainError('SNAPSHOT_TOO_LARGE', `当前公开集合规模 ${total} 超出可返回范围`);
    }
    const rows = await repository.listPublicRows(connection, {
      categoryCode: parsed.categoryCode,
      nowMs: now,
    });
    // 计数与读取之间的并发新增仍可能越界，同样按超量失败，不静默丢弃多出的行。
    if (rows.length > max) {
      throw new DomainError('SNAPSHOT_TOO_LARGE', `当前公开集合规模 ${rows.length} 超出可返回范围`);
    }
    return buildResponse(rows, now, parsed.viewerLocation);
  });
}

module.exports = { searchPublicVendors };

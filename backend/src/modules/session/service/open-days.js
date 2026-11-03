/**
 * 当地出摊日读模型。
 * 需求出处：prd R7 与 doc/MVP/一期技术设计.md §10.3 —— 分页按 open_date 倒序稳定，
 * 同日多次开摊计一天；跨零点不自动增加次日；所有派生都在 JS 按上海当地日分组，不依赖 MySQL 时区表。
 */
const { withTransaction } = require('../../../db/transaction');
const { nowMs } = require('../../../db/clock');
const { DomainError } = require('../../../domain/errors');
const account = require('../../account');
const mapper = require('../mapper');
const repository = require('../repository');
const schema = require('../schema');
const time = require('../time');

function groupByDate(sessions, serverNowMs) {
  const grouped = new Map();
  for (const row of sessions) {
    const key = time.shanghaiDateKey(Number(row.started_at_ms));
    const startedAtMs = Number(row.started_at_ms);
    const endedAtMs = row.ended_at_ms === null
      ? Math.min(Number(row.planned_end_at_ms), serverNowMs)
      : Number(row.ended_at_ms);
    const entry = grouped.get(key) || {
      sessionCount: 0,
      firstStartedAtMs: startedAtMs,
      lastEndedAtMs: 0,
      allLive: true,
    };
    entry.sessionCount += 1;
    entry.firstStartedAtMs = Math.min(entry.firstStartedAtMs, startedAtMs);
    entry.lastEndedAtMs = Math.max(entry.lastEndedAtMs, endedAtMs);
    if (row.ended_at_ms !== null) entry.allLive = false;
    grouped.set(key, entry);
  }
  return grouped;
}

async function buildPage(connection, { vendorId, pageRows, serverNowMs }) {
  if (pageRows.length === 0) return [];
  const dateKeys = pageRows.map((row) => String(row.open_date));
  // pageRows 按 open_date DESC，首行为最大当地日；区间取 [最早日 00:00, 最大日 +1 天 00:00)。
  const fromMs = time.clockOnDate(dateKeys[dateKeys.length - 1], 0);
  const toMs = time.clockOnDate(time.addDays(dateKeys[0], 1), 0);
  const sessions = await repository.listSessionsByRange(connection, { vendorId, fromMs, toMs });
  const grouped = groupByDate(sessions, serverNowMs);
  return pageRows.map((row) => {
    const openDate = String(row.open_date);
    const stat = grouped.get(openDate);
    return mapper.toOpenDayRow({
      openDate,
      sessionCount: stat ? stat.sessionCount : 0,
      firstStartedAtMs: stat ? stat.firstStartedAtMs : Number(row.created_at_ms),
      lastEndedAtMs: stat && !stat.allLive ? stat.lastEndedAtMs : null,
    });
  });
}

async function listOpenDays(identity, query) {
  const actor = await account.resolveAccount(identity);
  const params = schema.normalizeOpenDaysQuery(query);
  return withTransaction(async (connection) => {
    const serverNowMs = await nowMs(connection);
    const vendor = await repository.findVendorByAccount(connection, actor.id);
    if (!vendor) throw new DomainError('RESOURCE_NOT_FOUND');
    if (vendor.lifecycle_status !== 'ACTIVE') throw new DomainError('NOT_ELIGIBLE');
    const vendorId = Number(vendor.id);
    const rows = await repository.listOpenDays(connection, {
      vendorId, cursor: params.cursor, limit: params.limit,
    });
    const pageRows = rows.slice(0, params.limit);
    const totalDays = await repository.countOpenDays(connection, vendorId);
    const result = {
      totalDays,
      rows: await buildPage(connection, { vendorId, pageRows, serverNowMs }),
    };
    if (rows.length > params.limit) {
      const last = pageRows[pageRows.length - 1];
      result.nextCursor = schema.encodeCursor({ openDate: String(last.open_date), id: String(last.id) });
    }
    return result;
  });
}

module.exports = { listOpenDays };

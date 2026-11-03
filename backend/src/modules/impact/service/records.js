/**
 * 影响记录写入与本人读取。
 *
 * 只有两种来源会生成本人可见影响：反馈核实成立（FEEDBACK_CASE）与管理处理措施
 * （MANAGEMENT_ACTION）。写入发生在产生结论的同一个事务里，禁止事后补写。
 *
 * 复核期限：文档未给具体天数，本期取 30 个上海自然日（UTC+8 无夏令时，按毫秒相加
 * 即同一钟点）；如需调整只改 IMPACT_REVIEW_WINDOW_MS 一处。
 */
const { withTransaction } = require('../../../db/transaction');
const { DomainError } = require('../../../domain/errors');
const account = require('../../account');
const repository = require('../repository');
const mapper = require('../mapper');

const DAY_MS = 86_400_000;
const IMPACT_REVIEW_WINDOW_MS = 30 * DAY_MS;
const SUMMARY_MAX = 500;

async function recordInTransaction(connection, {
  vendorId, sourceType, sourceId, summary, createdAtMs,
}) {
  const existing = await repository.findBySource(connection, { sourceType, sourceId });
  if (existing) return Number(existing.id);
  const text = String(summary || '').trim().slice(0, SUMMARY_MAX);
  try {
    return await repository.insertRecord(connection, {
      vendorId,
      sourceType,
      sourceId,
      summary: text || '管理处理措施',
      status: 'ACTIVE',
      createdAtMs,
      reviewableUntilMs: createdAtMs + IMPACT_REVIEW_WINDOW_MS,
    });
  } catch (error) {
    // 并发下同一来源只留一条：撞唯一键时复用已存在记录，不把一个结论写成两条影响。
    if (error && error.code === 'ER_DUP_ENTRY') {
      const again = await repository.findBySource(connection, { sourceType, sourceId });
      if (again) return Number(again.id);
    }
    throw error;
  }
}

/** 游标绑定本人摊主与顺序，不透明但可校验；格式异常按入参错误处理。 */
function parseQuery(query) {
  const input = query || {};
  for (const key of Object.keys(input)) {
    if (key !== 'cursor' && key !== 'limit') {
      throw new DomainError('VALIDATION_FAILED', '请求参数不合法', { fields: [{ field: key, reason: 'UNKNOWN_FIELD' }] });
    }
  }
  const rawCursor = input.cursor === undefined || input.cursor === null || input.cursor === ''
    ? null : String(input.cursor);
  const limit = input.limit === undefined || input.limit === null || input.limit === ''
    ? 20 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new DomainError('VALIDATION_FAILED', '请求参数不合法', { fields: [{ field: 'limit', reason: 'OUT_OF_RANGE' }] });
  }
  let cursor = null;
  if (rawCursor !== null) {
    if (!/^\d{1,16}_\d{1,20}$/.test(rawCursor)) {
      throw new DomainError('VALIDATION_FAILED', '请求参数不合法', { fields: [{ field: 'cursor', reason: 'INVALID' }] });
    }
    cursor = {
      createdAtMs: Number(rawCursor.split('_')[0]),
      impactRecordId: rawCursor.split('_')[1],
    };
  }
  return { cursor, limit };
}

/** 无摊主账号返回空列表：没有摊主身份就没有影响记录，不用 404 泄露摊主是否存在。 */
async function listMyImpacts(identity, query) {
  const actor = await account.resolveAccount(identity);
  const input = parseQuery(query);
  return withTransaction(async (connection) => {
    const vendorId = await repository.findVendorIdByAccount(connection, actor.id);
    if (vendorId === null) return { rows: [], nextCursor: null };
    const rows = await repository.listForVendor(connection, {
      vendorId, cursor: input.cursor, limit: input.limit,
    });
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page.map(mapper.toListItem),
      nextCursor: hasMore && last ? `${last.created_at_ms}_${last.id}` : null,
    };
  });
}

/** 事务内读取来源对应的影响记录 ID：幂等回放与复核结果需要同一口径。 */
async function findImpactIdBySource(connection, { sourceType, sourceId }) {
  const row = await repository.findBySource(connection, { sourceType, sourceId });
  return row ? Number(row.id) : null;
}

/** 摊主的已成立影响数量：清除预览要说明哪些处理历史不会被删除。 */
async function countRecordsByVendorInTransaction(connection, { vendorId }) {
  return repository.countRecordsByVendor(connection, vendorId);
}

module.exports = {
  recordInTransaction,
  listMyImpacts,
  findImpactIdBySource,
  countRecordsByVendorInTransaction,
  IMPACT_REVIEW_WINDOW_MS,
};

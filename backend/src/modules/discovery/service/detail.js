/**
 * 公开详情：OPEN / RESTING / UNVIEWABLE 三态。
 * 休息分支只保留生效资料，坐标、距离与导航资格字段一律缺省；
 * 受限、被清除与不存在统一返回不可查看投影，不透露限制原因。
 */
const { withTransaction } = require('../../../db/transaction');
const session = require('../../session');
const repository = require('../repository');
const mapper = require('../mapper');
const { describeAvailability } = require('./qualify');
const { parseVendorId } = require('../schema');

async function getPublicVendor(rawVendorId) {
  const vendorId = parseVendorId(rawVendorId);
  return withTransaction(async (connection) => {
    const now = await repository.readNowMs(connection);
    const row = await repository.findPublicRowById(connection, vendorId);
    const availability = describeAvailability(row, now);
    if (availability !== 'OPEN') {
      return mapper.toPublicDetail(row, { availability, vendorId, serverNowMs: now });
    }
    const phaseInfo = session.deriveSessionPhase({
      nowMs: now,
      startedAtMs: Number(row.started_at_ms),
      plannedEndAtMs: Number(row.planned_end_at_ms),
    });
    return mapper.toPublicDetail(row, {
      availability, phaseInfo, vendorId, serverNowMs: now,
    });
  });
}

module.exports = { getPublicVendor };

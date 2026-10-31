/**
 * 位置公开期到期终态化脚本（批处理）。
 *
 * 公开期的正确性由读路径保证（查询侧直接按 public_until_ms 判定），
 * 本脚本只负责把已到期且仍标记为公开的位置置为 EXPIRED，用于审计与后续受限留存清理。
 * 条件更新保证重复执行结果一致。
 */
const { expirePositions } = require('../src/domain/location/location-service');
const { closeDatabase } = require('../src/config/database');

const nowMs = Date.now();

expirePositions({ nowMs })
  .then((result) => {
    process.stdout.write(`${JSON.stringify({ nowMs, ...result })}\n`);
  })
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(closeDatabase);

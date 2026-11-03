/**
 * 写命令统一包装。
 *
 * 为什么必须经这里：一期所有写接口都要求 Idempotency-Key（契约 §5）。
 * 一旦某个写函数忘了传键，网络重试就可能产生第二条业务数据 ——
 * 而这个错误在联调阶段往往看不出来。所以这里在开发期直接抛错，
 * 而不是"没传就帮你生成一个"（那会让每次重试都是新意图）。
 *
 * 键的生命周期由 services/submission 管理：一次用户意图一个键，
 * 超时后按同一个键查询结果，只有用户重新决定才换键。
 */
const { post, put, remove } = require('../utils/request');

/**
 * @param {function} method  utils/request 的 post/put/remove
 * @param {string} path      取自 config/endpoints.js
 * @param {object} payload
 * @param {object} options   { idempotencyKey }
 */
function withIdempotency(method, path, payload, options = {}) {
  if (!options || !options.idempotencyKey) {
    throw new TypeError(`写接口 ${path} 必须提供 idempotencyKey`);
  }
  return method(path, payload, { idempotencyKey: options.idempotencyKey });
}

function writePost(path, payload, options) {
  return withIdempotency(post, path, payload, options);
}

function writePut(path, payload, options) {
  return withIdempotency(put, path, payload, options);
}

function writeDelete(path, payload, options) {
  return withIdempotency(remove, path, payload, options);
}

module.exports = { withIdempotency, writePost, writePut, writeDelete };

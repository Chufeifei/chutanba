const { get, post, put, remove } = require('../utils/request');

function idempotencyKey(prefix = 'wx') {
  const safePrefix = String(prefix || 'wx').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 20) || 'wx';
  const random = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 16);
  return `${safePrefix}:${Date.now()}:${random}`.slice(0, 64);
}

function withIdempotency(method, path, data = {}, prefix, options = {}) {
  const key = options.idempotencyKey || data.idempotencyKey || idempotencyKey(prefix);
  const payload = data && typeof data === 'object' && !Array.isArray(data)
    ? { ...data, idempotencyKey: data.idempotencyKey || key }
    : data;
  return method(path, payload, {
    ...options,
    idempotencyKey: key,
    header: { ...(options.header || {}), 'Idempotency-Key': key, 'X-Request-Id': key },
  });
}

module.exports = { get, post, put, remove, idempotencyKey, withIdempotency };

const assert = require('node:assert/strict');
const test = require('node:test');

const { extractTrustedIdentity, requireIdentity } = require('../src/middlewares/auth');

function request(headers = {}) {
  return { headers, body: { openid: 'body-openid', role: 'SUPER_ADMIN' }, query: { openid: 'query-openid' } };
}

function config(nodeEnv, allowDev) {
  return { nodeEnv, identity: { allowDev } };
}

test('platform headers take precedence over the dev simulation header', () => {
  const identity = extractTrustedIdentity(
    request({ 'x-wx-openid': 'platform-openid', 'x-wx-unionid': 'union', 'x-wx-userid': '1001', 'x-dev-openid': 'dev' }),
    config('development', true),
  );
  assert.deepEqual(identity, {
    openid: 'platform-openid', unionid: 'union', userId: 1001, source: 'platform',
  });
});

test('production ignores X-Dev-Openid even when ALLOW_DEV_IDENTITY=true', () => {
  assert.equal(extractTrustedIdentity(request({ 'x-dev-openid': 'dev' }), config('production', true)), null);
});

test('non-production ignores X-Dev-Openid unless explicitly enabled', () => {
  assert.equal(extractTrustedIdentity(request({ 'x-dev-openid': 'dev' }), config('development', false)), null);
  assert.equal(extractTrustedIdentity(request({ 'x-dev-openid': 'dev' }), config('test', false)), null);
});

test('non-production accepts X-Dev-Openid only when the switch is on', () => {
  assert.deepEqual(
    extractTrustedIdentity(request({ 'x-dev-openid': 'dev-openid' }), config('development', true)),
    { openid: 'dev-openid', unionid: null, userId: null, source: 'dev' },
  );
});

test('body and query parameters never establish an identity', () => {
  assert.equal(extractTrustedIdentity(request(), config('development', true)), null);
});

test('requireIdentity converts anonymous requests into AUTH_REQUIRED', () => {
  let received;
  requireIdentity({ identity: null }, {}, (error) => { received = error; });
  assert.equal(received.name, 'DomainError');
  assert.equal(received.bizCode, 'AUTH_REQUIRED');
  assert.equal(received.httpStatus, 401);
});

test('requireIdentity passes identified requests through', () => {
  let called = false;
  requireIdentity({ identity: { openid: 'openid', source: 'platform' } }, {}, () => { called = true; });
  assert.equal(called, true);
});

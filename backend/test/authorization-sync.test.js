const assert = require('node:assert/strict');
const test = require('node:test');

const { expectedGrants, ROLE_NAMES, PERMISSION_NAMES } =
  require('../src/modules/authorization/schema');

function config(overrides = {}) {
  return {
    superAdminOpenids: [],
    adminOpenids: [],
    profileReviewerOpenids: [],
    fieldReviewerOpenids: [],
    ...overrides,
  };
}

test('empty deployment lists grant nothing', () => {
  assert.deepEqual(expectedGrants(config(), 'openid-a'), { roles: [], permissions: [] });
});

test('one account can hold multiple roles and reviewer permissions', () => {
  assert.deepEqual(expectedGrants(config({
    superAdminOpenids: ['openid-a'],
    profileReviewerOpenids: ['openid-a'],
    fieldReviewerOpenids: ['openid-a'],
  }), 'openid-a'), {
    roles: ['SUPER_ADMIN'],
    permissions: ['PROFILE_REVIEWER', 'FIELD_REVIEWER'],
  });
});

test('only listed openids receive grants', () => {
  assert.deepEqual(expectedGrants(config({ adminOpenids: ['openid-b'] }), 'openid-a'), {
    roles: [], permissions: [],
  });
});

test('matching is exact, never prefix-based', () => {
  assert.deepEqual(expectedGrants(config({ adminOpenids: ['openid-a-long'] }), 'openid-a'), {
    roles: [], permissions: [],
  });
});

test('capability order is stable and does not expand SUPER_ADMIN', () => {
  assert.deepEqual(ROLE_NAMES, ['SUPER_ADMIN', 'ADMIN']);
  assert.deepEqual(PERMISSION_NAMES, ['PROFILE_REVIEWER', 'FIELD_REVIEWER']);
  const { roles, permissions } = expectedGrants(config({
    adminOpenids: ['openid-a'], fieldReviewerOpenids: ['openid-a'],
  }), 'openid-a');
  assert.deepEqual([...roles, ...permissions], ['ADMIN', 'FIELD_REVIEWER']);
});

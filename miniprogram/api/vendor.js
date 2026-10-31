const { get, post, put } = require('../utils/request');
const { withIdempotency } = require('./core-v2');

async function rawProfile() {
  return get('/api/v2/me/profile');
}

function legacyView(response) {
  const source = response.data || {};
  const current = source.current;
  return {
    ...response,
    data: {
      profile: current ? {
        displayName: current.vendorName,
        categoryCode: current.categoryCode,
        priceDescription: current.priceDescription,
        averagePriceMin: current.averagePriceMin,
        averagePriceMax: current.averagePriceMax,
        bio: current.announcement,
        reservationNote: current.reservationNote,
        expectedStartTime: current.expectedStartTime,
        expectedEndTime: current.expectedEndTime,
        expectedEndNextDay: current.expectedEndNextDay,
        avatarUrl: current.media.find((item) => item.type === 'AVATAR')?.objectKey || '',
        welfare: { enabled: current.benefitEnabled, content: current.benefitContent || '' },
      } : null,
      products: current ? current.products.map((item) => ({
        id: item.itemKey,
        itemKey: item.itemKey,
        name: item.name,
        price: item.priceText,
        priceText: item.priceText,
        visible: item.visible,
        approved: true,
      })) : [],
      images: current ? current.media.filter((item) => item.type === 'CONTENT').map((item) => ({ id: item.objectKey, url: item.objectKey })) : [],
      calendar: current?.calendar || null,
      audit: source.pending ? {
        status: source.pending.decision === 'REJECTED' ? 'REJECTED' : 'PENDING',
        note: source.pending.decision_reason,
        reviewTaskId: source.pending.review_task_id,
        submissionId: source.pending.submission_id,
        reviewAppealId: source.pending.review_appeal_id,
        appealPending: source.pending.review_stage === 'APPEAL'
          && source.pending.review_status === 'PENDING'
          && source.pending.appeal_status === 'PENDING',
        appealEligible: source.pending.method === 'AI'
          && source.pending.decision === 'REJECTED'
          && !source.pending.review_appeal_id
          && Number(source.pending.available_to_vendor_at_ms) + 7 * 86400000 > Date.now(),
      } : (current ? { status: 'APPROVED' } : null),
      v2: source,
    },
  };
}

async function getProfile() {
  return legacyView(await rawProfile());
}

function snapshotFrom(current, patch = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);
  const avatar = has('avatarUrl')
    ? patch.avatarUrl
    : current?.media?.find((item) => item.type === 'AVATAR')?.objectKey;
  const contentMedia = has('images')
    ? (patch.images || []).map((item, index) => ({
      type: 'CONTENT', objectKey: item.url || item.objectKey || item, sortOrder: index + 1,
    }))
    : (current?.media || []).filter((item) => item.type === 'CONTENT');
  return {
    vendorName: has('displayName') ? patch.displayName : (patch.vendorName ?? current?.vendorName),
    categoryCode: String(has('categoryCode') ? patch.categoryCode : (current?.categoryCode || 'OTHER')),
    priceDescription: has('priceDescription') ? patch.priceDescription : (current?.priceDescription || '价格以现场为准'),
    averagePriceMin: has('averagePriceMin') ? patch.averagePriceMin : (current?.averagePriceMin ?? null),
    averagePriceMax: has('averagePriceMax') ? patch.averagePriceMax : (current?.averagePriceMax ?? null),
    announcement: has('bio') ? patch.bio : (patch.announcement ?? current?.announcement ?? ''),
    reservationNote: has('reservationNote') ? patch.reservationNote : (current?.reservationNote ?? null),
    benefitContent: has('welfareContent')
      ? (patch.welfareContent || null)
      : (patch.welfare?.content ?? patch.benefitContent ?? current?.benefitContent ?? null),
    expectedStartTime: has('expectedStartTime') ? patch.expectedStartTime : (current?.expectedStartTime ?? null),
    expectedEndTime: has('expectedEndTime') ? patch.expectedEndTime : (current?.expectedEndTime ?? null),
    expectedEndNextDay: has('expectedEndNextDay') ? patch.expectedEndNextDay : (current?.expectedEndNextDay ?? false),
    products: patch.products || current?.products || [],
    media: [
      ...(avatar ? [{ type: 'AVATAR', objectKey: avatar, sortOrder: 0 }] : []),
      ...contentMedia,
    ],
    calendar: has('calendar') ? patch.calendar : (current?.calendar || { baseMode: 'EVERY_DAY', exceptions: [] }),
  };
}

async function submitSnapshot(patch) {
  const currentResponse = await rawProfile();
  const snapshot = snapshotFrom(currentResponse.data?.current, patch);
  const result = await withIdempotency(post, '/api/v2/vendor/profile-submissions', snapshot, 'profile');
  return result;
}

async function saveProfile(payload) {
  return submitSnapshot(payload);
}

function withdrawSubmission(submissionId) {
  return withIdempotency(post, `/api/v2/vendor/profile-submissions/${submissionId}/withdraw`, {}, 'profile-withdraw');
}

async function saveProduct(payload) {
  const response = await rawProfile();
  const current = response.data?.current;
  if (!current) throw new Error('请先提交并通过基础摊主资料');
  const itemKey = payload.itemKey || payload.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const products = current.products.slice();
  const existingIndex = products.findIndex((item) => item.itemKey === itemKey);
  const next = {
    itemKey,
    name: payload.name,
    priceText: payload.priceText || String(payload.price ?? '面议'),
    sortOrder: existingIndex >= 0 ? existingIndex : products.length,
    visible: existingIndex >= 0 ? products[existingIndex].visible : true,
  };
  if (existingIndex >= 0) products.splice(existingIndex, 1, next); else products.push(next);
  return submitSnapshot({ products });
}

async function deleteProduct(productId) {
  const response = await rawProfile();
  const current = response.data?.current;
  return submitSnapshot({ products: (current?.products || []).filter((item) => item.itemKey !== productId) });
}

async function saveCalendar(rules) {
  const rule = Array.isArray(rules) ? rules[0] : rules;
  return submitSnapshot({ calendar: rule?.baseMode ? rule : { baseMode: rule?.ruleType || 'EVERY_DAY', exceptions: [] } });
}

async function addImage(url) {
  return { code: 200, msg: 'ok', data: { id: url, url } };
}

async function appeal(payload) {
  const response = await rawProfile();
  const reviewTaskId = response.data?.pending?.review_task_id;
  if (!reviewTaskId) throw new Error('当前没有可申诉的审核结果');
  return post(`/api/v2/vendor/profile-reviews/${reviewTaskId}/appeals`, { statement: payload.content || payload.statement });
}

async function withdrawAppeal(reviewAppealId) {
  return post(`/api/v2/vendor/profile-review-appeals/${reviewAppealId}/withdraw`, {});
}

async function setProductVisibility(itemKey, visible) {
  return put(`/api/v2/vendor/products/${itemKey}/visibility`, { visible });
}

async function setBenefitEnabled(enabled) {
  return put('/api/v2/vendor/benefit', { enabled });
}

module.exports = {
  getProfile, saveProfile, withdrawSubmission, saveProduct, deleteProduct, saveCalendar, addImage, appeal, withdrawAppeal,
  setProductVisibility, setBenefitEnabled,
};

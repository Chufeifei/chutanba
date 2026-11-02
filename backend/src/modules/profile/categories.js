/**
 * 一期品类码服务端冻结目录，取值与 miniprogram/config/categories.js 的 25 个码一致。
 * 运行时后端不引用小程序目录；码集合漂移由 backend/test/profile-schema.test.js 断言。
 * 未知码返回 VALIDATION_FAILED，不静默映射为 OTHER。
 */
const CATEGORY_CODES = Object.freeze([
  'SNACK', 'FRIED_SNACK', 'PANCAKE', 'ROASTED_SNACK',
  'SKEWER', 'NIGHT_SNACK', 'TEPPANYAKI',
  'MEAL', 'RICE', 'DONBURI',
  'NOODLES', 'DUMPLING', 'BUN_CONGEE',
  'MALATANG', 'BRAISED', 'SPICY_POT',
  'DRINK', 'COFFEE', 'DESSERT',
  'BREAKFAST', 'BAKERY',
  'FRUIT', 'FARM',
  'SPECIALTY', 'OTHER',
]);

function isCategoryCode(code) {
  return typeof code === 'string' && CATEGORY_CODES.includes(code);
}

module.exports = { CATEGORY_CODES, isCategoryCode };

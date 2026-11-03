/**
 * 公开品类目录（契约 §5.1 的 GET /public/categories）。
 * 码集合与 miniprogram/config/categories.js 的 25 个码一致，由
 * backend/test/w5-public-rules.test.js 断言；后端运行时不引用小程序目录。
 * defaultVisual 复用小程序默认图形，服务端不解释其含义。
 */
const VERSION = 'v1';

const CATEGORY_GROUPS = Object.freeze([
  {
    code: 'SNACKS',
    items: [
      { code: 'SNACK', name: '特色小吃', defaultVisual: '🍢' },
      { code: 'FRIED_SNACK', name: '炸物小吃', defaultVisual: '🍗' },
      { code: 'PANCAKE', name: '煎饼卷饼', defaultVisual: '🫓' },
      { code: 'ROASTED_SNACK', name: '炉烤小吃', defaultVisual: '🍠' },
    ],
  },
  {
    code: 'BARBECUE_SUPPER',
    items: [
      { code: 'SKEWER', name: '烧烤烤串', defaultVisual: '🍢' },
      { code: 'NIGHT_SNACK', name: '夜宵', defaultVisual: '🌙' },
      { code: 'TEPPANYAKI', name: '铁板小吃', defaultVisual: '🥩' },
    ],
  },
  {
    code: 'RICE_FAST_FOOD',
    items: [
      { code: 'MEAL', name: '快餐便当', defaultVisual: '🍱' },
      { code: 'RICE', name: '盖饭炒饭', defaultVisual: '🍚' },
      { code: 'DONBURI', name: '拌饭焖饭', defaultVisual: '🍛' },
    ],
  },
  {
    code: 'NOODLES_DUMPLINGS',
    items: [
      { code: 'NOODLES', name: '面馆米粉', defaultVisual: '🍜' },
      { code: 'DUMPLING', name: '饺子馄饨', defaultVisual: '🥟' },
      { code: 'BUN_CONGEE', name: '包子粥店', defaultVisual: '🥯' },
    ],
  },
  {
    code: 'SPICY_BRAISED',
    items: [
      { code: 'MALATANG', name: '麻辣烫冒菜', defaultVisual: '🍲' },
      { code: 'BRAISED', name: '卤味熟食', defaultVisual: '🍗' },
      { code: 'SPICY_POT', name: '香锅干锅', defaultVisual: '🫕' },
    ],
  },
  {
    code: 'DRINKS_DESSERTS',
    items: [
      { code: 'DRINK', name: '茶饮果汁', defaultVisual: '🥤' },
      { code: 'COFFEE', name: '咖啡', defaultVisual: '☕' },
      { code: 'DESSERT', name: '甜品冰品', defaultVisual: '🍨' },
    ],
  },
  {
    code: 'BREAKFAST_BAKERY',
    items: [
      { code: 'BREAKFAST', name: '中式早餐', defaultVisual: '🥣' },
      { code: 'BAKERY', name: '面包烘焙', defaultVisual: '🥐' },
    ],
  },
  {
    code: 'FRUIT_FRESH',
    items: [
      { code: 'FRUIT', name: '水果果切', defaultVisual: '🍉' },
      { code: 'FARM', name: '农副特产', defaultVisual: '🧺' },
    ],
  },
  {
    code: 'LOCAL_OTHER',
    items: [
      { code: 'SPECIALTY', name: '地方特色', defaultVisual: '🏛️' },
      { code: 'OTHER', name: '其他品类', defaultVisual: '🛒' },
    ],
  },
]);

/** 冻结后的扁平码表：公开响应按此顺序输出，保持客户端展示稳定。 */
const CATEGORIES = Object.freeze(CATEGORY_GROUPS.flatMap((group) => group.items.map((item) => Object.freeze({
  code: item.code,
  name: item.name,
  groupCode: group.code,
  defaultVisual: item.defaultVisual,
}))));

const CATEGORY_CODES = Object.freeze(CATEGORIES.map((item) => item.code));

function isCategoryCode(code) {
  return typeof code === 'string' && CATEGORY_CODES.includes(code);
}

module.exports = {
  VERSION,
  CATEGORIES,
  CATEGORY_CODES,
  CATEGORY_GROUPS,
  isCategoryCode,
};

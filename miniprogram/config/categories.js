const CATEGORY_GROUPS = [
  {
    code: 'SNACKS', name: '小吃炸物', emoji: '🍟',
    items: [
      { code: 'SNACK', name: '特色小吃', emoji: '🍢', examples: '臭豆腐、狼牙土豆、烤冷面' },
      { code: 'FRIED_SNACK', name: '炸物小吃', emoji: '🍗', examples: '炸串、鸡柳、盐酥鸡' },
      { code: 'PANCAKE', name: '煎饼卷饼', emoji: '🫓', examples: '煎饼果子、手抓饼、鸡蛋灌饼' },
      { code: 'ROASTED_SNACK', name: '炉烤小吃', emoji: '🍠', examples: '烤红薯、烤玉米、糖炒栗子' },
    ],
  },
  {
    code: 'BARBECUE_SUPPER', name: '烧烤夜宵', emoji: '🌢️',
    items: [
      { code: 'SKEWER', name: '烧烤烤串', emoji: '🍢', examples: '肉串、烤筋、烤蔬菜' },
      { code: 'NIGHT_SNACK', name: '夜宵', emoji: '🌙', examples: '炒粉、小龙虾、夜宵小炒' },
      { code: 'TEPPANYAKI', name: '铁板小吃', emoji: '🥩', examples: '铁板鱿鱼、铁板豆腐、铁板烧' },
    ],
  },
  {
    code: 'RICE_FAST_FOOD', name: '米饭快餐', emoji: '🍱',
    items: [
      { code: 'MEAL', name: '快餐便当', emoji: '🍱', examples: '中式快餐、便当、套餐' },
      { code: 'RICE', name: '盖饭炒饭', emoji: '🍚', examples: '盖浇饭、炒饭、烩饭' },
      { code: 'DONBURI', name: '拌饭焖饭', emoji: '🍛', examples: '石锅拌饭、焖肉饭、咖喱饭' },
    ],
  },
  {
    code: 'NOODLES_DUMPLINGS', name: '粉面饺子', emoji: '🍜',
    items: [
      { code: 'NOODLES', name: '面馆米粉', emoji: '🍜', examples: '拉面、米粉、螺蛳粉、凉皮' },
      { code: 'DUMPLING', name: '饺子馄饨', emoji: '🥟', examples: '水饺、锅贴、馄饨、抄手' },
      { code: 'BUN_CONGEE', name: '包子粥店', emoji: '🥯', examples: '包子、烧麦、粥、豆浆' },
    ],
  },
  {
    code: 'SPICY_BRAISED', name: '麻辣卤味', emoji: '🌶️',
    items: [
      { code: 'MALATANG', name: '麻辣烫冒菜', emoji: '🍲', examples: '麻辣烫、冒菜、串串香' },
      { code: 'BRAISED', name: '卤味熟食', emoji: '🍗', examples: '卤味、鸭货、凉菜、熟食' },
      { code: 'SPICY_POT', name: '香锅干锅', emoji: '🫕', examples: '麻辣香锅、干锅、麻辣拌' },
    ],
  },
  {
    code: 'DRINKS_DESSERTS', name: '饮品甜点', emoji: '🥤',
    items: [
      { code: 'DRINK', name: '茶饮果汁', emoji: '🥤', examples: '奶茶、果茶、果汁、冰饮' },
      { code: 'COFFEE', name: '咖啡', emoji: '☕', examples: '现磨咖啡、特调、冰咖啡' },
      { code: 'DESSERT', name: '甜品冰品', emoji: '🍨', examples: '糖水、冰粉、双皮奶、冰淇淋' },
    ],
  },
  {
    code: 'BREAKFAST_BAKERY', name: '早餐烘焙', emoji: '🥐',
    items: [
      { code: 'BREAKFAST', name: '中式早餐', emoji: '🥣', examples: '油条、豆浆、肠粉、饭团' },
      { code: 'BAKERY', name: '面包烘焙', emoji: '🥐', examples: '面包、蛋糕、饼干、蛋挞' },
    ],
  },
  {
    code: 'FRUIT_FRESH', name: '水果生鲜', emoji: '🍉',
    items: [
      { code: 'FRUIT', name: '水果果切', emoji: '🍉', examples: '新鲜水果、果切、水果杯' },
      { code: 'FARM', name: '农副特产', emoji: '🧺', examples: '土特产、干货、农副产品' },
    ],
  },
  {
    code: 'LOCAL_OTHER', name: '地方特色', emoji: '🏛️',
    items: [
      { code: 'SPECIALTY', name: '地方特色', emoji: '🏛️', examples: '地方小吃、家乡风味、非遗美食' },
      { code: 'OTHER', name: '其他品类', emoji: '🛒', examples: '暂无合适品类时选择' },
    ],
  },
];

const CATEGORY_ITEMS = CATEGORY_GROUPS.reduce((all, group) => all.concat(
  group.items.map((item) => ({ ...item, groupCode: group.code, groupName: group.name })),
), []);

function getCategory(code) {
  return CATEGORY_ITEMS.find((item) => item.code === code) || null;
}

function getCategoryGroup(code) {
  const item = getCategory(code);
  return item ? CATEGORY_GROUPS.find((group) => group.code === item.groupCode) || null : null;
}

function getCategoryName(code) {
  return getCategory(code)?.name || (code ? '其他品类' : '未选择');
}

function getCategoryEmoji(code) {
  return getCategory(code)?.emoji || '🛒';
}

function categoryMatchesGroup(code, groupCode) {
  return !groupCode || getCategory(code)?.groupCode === groupCode;
}

module.exports = {
  CATEGORY_GROUPS,
  CATEGORY_ITEMS,
  getCategory,
  getCategoryGroup,
  getCategoryName,
  getCategoryEmoji,
  categoryMatchesGroup,
};

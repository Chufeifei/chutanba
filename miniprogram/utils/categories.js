const CATEGORY_OPTIONS = [
  { value: '饭团便当', icon: '/assets/icons/category-rice.png' },
  { value: '早餐早点', icon: '/assets/icons/category-breakfast.png' },
  { value: '面点小吃', icon: '/assets/icons/category-dumpling.png' },
  { value: '粉面汤粥', icon: '/assets/icons/category-noodles.png' },
  { value: '烧烤炸物', icon: '/assets/icons/category-skewer.png' },
  { value: '熟食卤味', icon: '/assets/icons/category-braised.png' },
  { value: '甜品烘焙', icon: '/assets/icons/category-bakery.png' },
  { value: '冰粉糖水', icon: '/assets/icons/category-dessert.png' },
  { value: '咖啡茶饮', icon: '/assets/icons/category-drink.png' },
  { value: '水果鲜食', icon: '/assets/icons/category-fruit.png' },
  { value: '地方特色', icon: '/assets/icons/category-specialty.png' },
  { value: '手作零食', icon: '/assets/icons/category-snack.png' },
  { value: '夜宵小炒', icon: '/assets/icons/category-supper.png' },
  { value: '农产品', icon: '/assets/icons/category-farm.png' },
  { value: '其他', icon: '/assets/icons/store.png' },
  { value: '自定义', icon: '/assets/icons/category-custom.png' }
]

function categoryIconPath(category) {
  const found = CATEGORY_OPTIONS.find(item => item.value === category)
  return found ? found.icon : '/assets/icons/category-custom.png'
}

function findCategoryIndex(category) {
  const index = CATEGORY_OPTIONS.findIndex(item => item.value === category)
  return index >= 0 ? index : CATEGORY_OPTIONS.length - 1
}

module.exports = {
  CATEGORY_OPTIONS,
  categoryIconPath,
  findCategoryIndex
}

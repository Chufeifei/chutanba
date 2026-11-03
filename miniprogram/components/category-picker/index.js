/**
 * 品类筛选栏（P01 使用，P08 资料表单复用同一份品类树）。
 *
 * 只筛品类，不提供区域或半径条件（需求 R-06：一期不支持按区域/半径筛选）。
 *
 * 传进来的必须是**叶子品类码**（如 SNACK / SKEWER）：后端白名单只认这 25 个码，
 * 分组码（SNACKS 之类）会被判 UNKNOWN_CATEGORY 直接 400。
 */
Component({
  properties: {
    items: { type: Array, value: [] },
    // 空串表示"全部"
    activeCode: { type: String, value: '' },
  },

  methods: {
    onSelect(event) {
      const code = event.currentTarget.dataset.code || '';
      if (code === this.properties.activeCode) return;
      this.triggerEvent('change', { code });
    },
  },
});

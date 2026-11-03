/**
 * 营业阶段徽标（正常营业 / 准备收摊 / 休息）。
 *
 * 只渲染服务端下发的阶段，不判断"是否临近截止" ——
 * 阶段推导在服务端（session/deriveSessionPhase），客户端重算就会出现
 * 列表说正常营业、详情说准备收摊的矛盾。
 */
Component({
  properties: {
    label: { type: String, value: '' },
    tone: { type: String, value: 'neutral' },
  },
});

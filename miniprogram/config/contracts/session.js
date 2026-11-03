/**
 * 营业轮次与公开可用性枚举。
 * 值必须与后端一致，页面只负责翻译，不参与资格判断。
 */

// 公开可用性：顾客端只认这三种结果，不区分"已清除"与"受限"的内部差别
const AVAILABILITY = Object.freeze({
  OPEN: 'OPEN',
  RESTING: 'RESTING',
  UNVIEWABLE: 'UNVIEWABLE',
});

// 营业阶段：由服务端按 S/E/N 推导下发，客户端只用于展示与按钮文案
const SESSION_PHASE = Object.freeze({
  OPEN: 'OPEN',
  PREPARING: 'PREPARING',
  RESTING: 'RESTING',
});

// 营业阶段展示文案：阶段值由服务端下发，客户端只负责翻译成中文
const SESSION_PHASE_LABEL = Object.freeze({
  OPEN: '正常营业',
  PREPARING: '准备收摊',
  RESTING: '休息中',
});

// 轮次结束原因：用于工作台与记录页展示，不参与客户端资格判断
const END_REASON = Object.freeze({
  MANUAL: 'MANUAL',
  DEADLINE: 'DEADLINE',
  SELF_STOP: 'SELF_STOP',
  GOVERNANCE: 'GOVERNANCE',
  CORRECTION: 'CORRECTION',
});

// 坐标链路统一 GCJ-02，不得混入 WGS-84 或 BD-09
const COORDINATE_SYSTEM = 'gcj02';

module.exports = {
  AVAILABILITY,
  SESSION_PHASE,
  SESSION_PHASE_LABEL,
  END_REASON,
  COORDINATE_SYSTEM,
};

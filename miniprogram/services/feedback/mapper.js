/**
 * 反馈相关的展示模型（候选 / 本人记录 / 提交结果）。
 *
 * 三条口径：
 * 1. 窗口只看服务端给的 eligible 与 eligibleUntilMs，页面不自己拿本机时钟比；
 * 2. 未核实必须能区分"证据不足"与"已证明不存在异常"（需求 C-03.6），
 *    所以结果文案按 resultReason 分四支，而不是一句"未通过"；
 * 3. 服务端投影里没有反馈人坐标、距离与内部证据，这里也不补。
 */
const {
  FEEDBACK_TYPE,
  FEEDBACK_TYPE_LABEL,
  FEEDBACK_CASE_STATUS,
  FEEDBACK_CASE_STATUS_LABEL,
  FEEDBACK_REASON,
} = require('../../config/contracts');
const { formatMoment } = require('../../utils/formatter');

const TYPE_OPTIONS = Object.freeze([
  {
    value: FEEDBACK_TYPE.OWNER_ABSENT,
    label: FEEDBACK_TYPE_LABEL[FEEDBACK_TYPE.OWNER_ABSENT],
    description: '摊主不在摊位，现场看不到营业迹象',
  },
  {
    value: FEEDBACK_TYPE.LOCATION_MISMATCH,
    label: FEEDBACK_TYPE_LABEL[FEEDBACK_TYPE.LOCATION_MISMATCH],
    description: '实际位置与页面显示的不一致',
  },
  {
    value: FEEDBACK_TYPE.ALREADY_LEFT,
    label: FEEDBACK_TYPE_LABEL[FEEDBACK_TYPE.ALREADY_LEFT],
    description: '摊位已收拾离开，本轮实际已结束',
  },
]);

// 未提交 / 待处理 → warning，已核实 → positive，未核实 → neutral（不是"失败"）
const STATUS_TONE = Object.freeze({
  [FEEDBACK_CASE_STATUS.PENDING]: 'warning',
  [FEEDBACK_CASE_STATUS.CONFIRMED]: 'positive',
  [FEEDBACK_CASE_STATUS.NOT_CONFIRMED]: 'negative',
});

// 未核实原因：必须让本人看懂"是没查清"还是"查清了没有问题"
const REASON_TEXT = Object.freeze({
  [FEEDBACK_REASON.INSUFFICIENT_EVIDENCE]: '现有信息不足以核实该情况',
  [FEEDBACK_REASON.DISPROVED]: '经核实不存在该情况',
  [FEEDBACK_REASON.MIXED]: '部分情况可核实，已按核实结果处理',
});

function typeLabelOf(type) {
  return FEEDBACK_TYPE_LABEL[type] || '现场反馈';
}

function reasonTextOf(reason) {
  return reason ? REASON_TEXT[reason] || '' : '';
}

/**
 * 可反馈轮次。
 * @param {object} item GET /me/feedback-candidates 的 items[]
 * @param {number} nowMs
 */
function toCandidateModel(item, nowMs) {
  const submitted = Array.isArray(item.submittedTypes) ? item.submittedTypes : [];
  return {
    observationId: String(item.observationId),
    observationVersion: Number(item.observationVersion) || 0,
    vendorName: (item.vendorSummary && item.vendorSummary.vendorName) || '摊主',
    eventText: formatMoment(item.eventAtMs, nowMs),
    eligible: item.eligible === true,
    windowText: item.eligible === true
      ? `可在 ${formatMoment(item.eligibleUntilMs, nowMs)} 前提交`
      : '已过受理窗口',
    eligibleUntilMs: Number(item.eligibleUntilMs) || 0,
    submittedTypes: submitted,
    submittedLabels: submitted.map(typeLabelOf),
    // wxml 里不拼字符串：数组直接渲染会变成 "a,b"，中文顿号在这里定好
    submittedText: submitted.map(typeLabelOf).join('、'),
    hasSubmitted: submitted.length > 0,
  };
}

/** 本人已提交记录：只给状态与时间，不给内部证据。 */
function toRecordModel(item, nowMs) {
  const status = item.status || FEEDBACK_CASE_STATUS.PENDING;
  return {
    feedbackFactId: String(item.feedbackFactId),
    caseId: String(item.caseId || ''),
    vendorName: (item.vendorSummary && item.vendorSummary.vendorName) || '摊主',
    typeLabel: typeLabelOf(item.type),
    status,
    statusLabel: FEEDBACK_CASE_STATUS_LABEL[status] || '待处理',
    statusTone: STATUS_TONE[status] || 'neutral',
    submittedText: formatMoment(item.submittedAtMs, nowMs),
    decidedText: item.decidedAtMs ? formatMoment(item.decidedAtMs, nowMs) : '',
    reasonText: reasonTextOf(item.resultReason),
  };
}

/**
 * 提交结果 / 记录详情 → 结果页模型。
 * 合并提示是展示层判断：同一次观察补充了另一种问题时会并入同一待处理事项，
 * 服务端的合并与去重不受这里影响。
 */
function toResultModel({
  status, reason = '', submittedAtMs, merged = false, vendorName = '', typeLabel = '', eventAtMs = 0,
}, nowMs) {
  const value = status || FEEDBACK_CASE_STATUS.PENDING;
  const base = {
    status: value,
    statusLabel: FEEDBACK_CASE_STATUS_LABEL[value] || '待处理',
    statusTone: STATUS_TONE[value] || 'neutral',
    reasonText: reasonTextOf(reason),
    submittedText: formatMoment(submittedAtMs, nowMs),
    // 事件摘要与问题类型：P06 必须让本人认出"是哪一次、哪一类"，否则无从判断结果
    vendorName,
    typeLabel,
    eventText: eventAtMs ? formatMoment(eventAtMs, nowMs) : '',
    notice: '反馈只作为现场线索，由平台人工核实；提交不会自动处罚摊主，也不会自动结束营业。',
  };
  if (value === FEEDBACK_CASE_STATUS.PENDING) {
    return {
      ...base,
      title: '已提交，等待人工核实',
      description: merged ? '已补充到待处理反馈' : '平台会尽快核实，结果可在"现场反馈"里查看',
    };
  }
  if (value === FEEDBACK_CASE_STATUS.CONFIRMED) {
    return { ...base, title: '已核实', description: '平台已核实该情况' };
  }
  return {
    ...base,
    title: '未核实',
    description: base.reasonText || '暂时无法核实该情况',
  };
}

module.exports = {
  TYPE_OPTIONS,
  typeLabelOf,
  reasonTextOf,
  toCandidateModel,
  toRecordModel,
  toResultModel,
};

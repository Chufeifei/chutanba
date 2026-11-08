/**
 * 管理端现场反馈复核编排（P16）。
 *
 * 三条链路：读取事项详情、逐事实核实、纠正当前轮次。
 * 核实与纠错是两次独立写，各自独立操作键，一个动作只做一件事，
 * 不用某个整体布尔值去凑 factResults。
 *
 * 全部写命令经 services/submission.runWrite 注入 Idempotency-Key；
 * 结果未知或 202 处理中时按原键 queryOutcome 查询，不换键重发。
 * 决定类版本只从 GET 详情响应读取，不推断、不写死。
 */
const feedbackApi = require('../../api/management-feedback');
const { runWrite, queryOutcome, QUERY_OUTCOME } = require('../submission');
const { WRITE_OUTCOME, ApiError, ERROR_CATEGORY } = require('../../utils/failure');
const { BIZ_CODE, FEEDBACK_TYPE_LABEL, FEEDBACK_CASE_STATUS_LABEL } = require('../../config/contracts');

// 与后端 operation.executeIdempotent 的 operationType 一致：
// 结果查询按类型精确匹配，两个动作分用两个键，互不影响。
const OPERATION = Object.freeze({
  DECISION: 'FEEDBACK_REVIEW_DECISION',
  CORRECTION: 'SESSION_CORRECTION',
});

// 逐事实结论与理由码取自后端白名单，不由页面自由填写。
const FACT_RESULT = Object.freeze({
  CONFIRM: 'CONFIRM',
  NOT_CONFIRM: 'NOT_CONFIRM',
});
const REASON_CODE = Object.freeze({
  CONFIRM: 'ON_SITE_CONFIRMED',
  NOT_CONFIRM: 'NO_ANOMALY_PROVEN',
});

const CORRECTION_ACTION = 'CLOSE_CURRENT';

// 最近一次 GET 详情的原始响应：决定类版本只从这里取，页面不传版本。
let loaded = null;

/** 毫秒时间戳转短文本；无值给占位符。 */
function timeText(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '—';
  const date = new Date(value);
  const pad = (n) => (n < 10 ? `0${n}` : String(n));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 单条事实的展示文本：类型、说明与事件时间都来自详情响应。 */
function factText(fact, index) {
  const label = FEEDBACK_TYPE_LABEL[fact.type] || `事实 ${index + 1}`;
  const desc = fact.description ? String(fact.description) : '';
  const when = timeText(fact.eventAtMs || fact.submittedAtMs);
  return desc ? `${label} · ${desc} · ${when}` : `${label} · ${when}`;
}

function supplementText(facts) {
  const parts = facts
    .map((fact) => (fact.description ? String(fact.description) : ''))
    .filter((text) => text !== '');
  return parts.length ? parts.join('；') : '暂无';
}

function recordText(review) {
  if (!review) return '暂无';
  return `${FEEDBACK_CASE_STATUS_LABEL[review.result] || '已记录'} · ${timeText(review.decidedAtMs)}`;
}

/**
 * 当前轮次版本只从 GET 详情响应读取。契约形态为 currentSession.version；
 * 若版本落在事实的 session 上，也只按 isCurrent 标记取，不自己推算。
 */
function readSessionVersion(detail) {
  if (detail.currentSession && Number.isInteger(detail.currentSession.version)) {
    return detail.currentSession.version;
  }
  if (Number.isInteger(detail.currentSessionVersion)) return detail.currentSessionVersion;
  const facts = Array.isArray(detail.facts) ? detail.facts : [];
  const current = facts.find((fact) => fact.session && fact.session.isCurrent === true);
  if (current && Number.isInteger(current.session.version)) return current.session.version;
  return null;
}

/** 详情响应归一成页面模型：字段全部正向取自 GET 响应。 */
function toCaseModel(detail) {
  const facts = Array.isArray(detail.facts) ? detail.facts : [];
  const currentSession = detail.currentSession || null;
  return {
    caseId: String(detail.caseId || ''),
    statusText: FEEDBACK_CASE_STATUS_LABEL[detail.status] || '—',
    typeText: FEEDBACK_TYPE_LABEL[detail.type] || '—',
    vendorText: (detail.vendorSummary && detail.vendorSummary.vendorName) || '—',
    openedText: timeText(detail.openedAtMs),
    currentSessionText: currentSession && currentSession.sessionId
      ? String(currentSession.sessionId)
      : (detail.currentSessionId ? String(detail.currentSessionId) : '—'),
    facts: facts.map((fact, index) => ({
      factId: String(fact.factId),
      text: factText(fact, index),
      result: '',
    })),
    supplementText: supplementText(facts),
    recordText: recordText(detail.review),
  };
}

function loadFailState(error) {
  if (error && error.bizCode === BIZ_CODE.PERMISSION_DENIED) return 'permission';
  if (error && error.bizCode === BIZ_CODE.RESOURCE_NOT_FOUND) return 'terminal';
  if (error && error.category === ERROR_CATEGORY.RETRYABLE) return 'retryable';
  return 'terminal';
}

/** 读取失败只给极短提示，错误码与规则解释不上屏。 */
function loadFailText(error) {
  const state = loadFailState(error);
  if (state === 'permission') return '无权查看';
  if (error && error.bizCode === BIZ_CODE.RESOURCE_NOT_FOUND) return '事项不存在';
  if (state === 'retryable') return '加载失败';
  return '暂不可用';
}

/**
 * 链路一：读取详情。成功时缓存原始响应供两条写链路取版本。
 *
 * 空 id 兜底：直接返回结构化空态（ok:false + empty:true + 极短提示），
 * 既不发出必失败的空详情请求，也不在此处静默取列表首项掩盖入口缺参问题。
 * 默认 caseId 由首页入口带参传入；若将来确需在此取默认事项，必须显式走
 * feedbackApi.listFieldFeedbackCases 并标注默认来源，不得隐式兜底。
 */
async function loadCase(caseId) {
  const id = String(caseId || '').trim();
  if (!id) return { ok: false, empty: true, state: 'empty', text: '缺少事项编号' };
  try {
    const response = await feedbackApi.getFieldFeedbackCase(id);
    const detail = (response && response.data) || {};
    loaded = { caseId: id, detail };
    return { ok: true, model: toCaseModel(detail) };
  } catch (error) {
    return { ok: false, state: loadFailState(error), text: loadFailText(error) };
  }
}

/**
 * 202 PROCESSING：服务端仍按该键处理，不能重发，也不能当成功把原键清掉。
 * 转成「结果未知」让 runWrite 保留键，页面随后按原键 queryOutcome 轮询。
 */
async function guardProcessing(task) {
  const response = await task;
  const data = response && response.data;
  if (data && data.status === 'PROCESSING') {
    throw new ApiError({
      message: '处理中',
      category: ERROR_CATEGORY.RETRYABLE,
      retryable: true,
      maybeDelivered: true,
    });
  }
  return response;
}

/**
 * 链路二：逐事实核实。factResults 由详情中的全部事实逐条生成，
 * 长度与事实数一致，缺任一条结论即不发写；expectedTaskVersion 取自 GET 详情。
 * 本次写单独使用 DECISION 操作键。
 */
async function submitDecision(facts) {
  if (!loaded) return { outcome: WRITE_OUTCOME.FAILED, notice: '请重新进入' };
  const { caseId, detail } = loaded;
  const source = Array.isArray(detail.facts) ? detail.facts : [];
  const selections = Array.isArray(facts) ? facts : [];
  const expectedTaskVersion = detail.taskVersion;
  if (!Number.isInteger(expectedTaskVersion) || expectedTaskVersion < 1) {
    return { outcome: WRITE_OUTCOME.FAILED, notice: '版本信息不可用' };
  }
  if (!source.length) {
    return { outcome: WRITE_OUTCOME.FAILED, notice: '暂无可处理事实' };
  }

  // 覆盖全部事实：以详情事实集合为准逐条取结论，不用整体布尔值凑数。
  const byId = new Map(selections.map((item) => [String(item.factId), item.result]));
  const factResults = source.map((fact) => {
    const result = byId.get(String(fact.factId));
    return {
      factId: String(fact.factId),
      result,
      reasonCode: result === FACT_RESULT.CONFIRM ? REASON_CODE.CONFIRM : REASON_CODE.NOT_CONFIRM,
    };
  });
  const complete = factResults.length === source.length
    && factResults.every((item) => (
      item.result === FACT_RESULT.CONFIRM || item.result === FACT_RESULT.NOT_CONFIRM
    ));
  if (!complete) {
    return { outcome: WRITE_OUTCOME.FAILED, notice: '请先选择每条事实结论' };
  }

  return runWrite({
    operationType: OPERATION.DECISION,
    execute: ({ idempotencyKey }) => guardProcessing(
      feedbackApi.decideFieldFeedbackCase(
        caseId,
        { factResults, expectedTaskVersion },
        { idempotencyKey },
      ),
    ),
  });
}

/**
 * 链路三：纠正当前轮次。独立动作、独立 CORRECTION 操作键，与核实写互不复用。
 * sessionId 与 expectedSessionVersion 都取自 GET 详情响应，不推断、不写死。
 */
async function submitCorrection(reason) {
  if (!loaded) return { outcome: WRITE_OUTCOME.FAILED, notice: '请重新进入' };
  const { detail } = loaded;
  const session = detail.currentSession || {};
  const sessionId = session.sessionId || detail.currentSessionId;
  const expectedSessionVersion = readSessionVersion(detail);
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) return { outcome: WRITE_OUTCOME.FAILED, notice: '请填写当前异常依据' };
  if (!sessionId || !Number.isInteger(expectedSessionVersion) || expectedSessionVersion < 1) {
    return { outcome: WRITE_OUTCOME.FAILED, notice: '当前轮次信息不完整' };
  }

  return runWrite({
    operationType: OPERATION.CORRECTION,
    execute: ({ idempotencyKey }) => guardProcessing(
      feedbackApi.correctCurrentSession(
        String(sessionId),
        {
          sourceCaseId: String(detail.caseId || loaded.caseId),
          action: CORRECTION_ACTION,
          reason: text,
          expectedSessionVersion,
        },
        { idempotencyKey },
      ),
    ),
  });
}

/** 按原操作键查询某个写动作的结果；处理中时页面继续查，不重发写。 */
async function queryOutcomeOf(action) {
  const operationType = action === 'correction' ? OPERATION.CORRECTION : OPERATION.DECISION;
  const result = await queryOutcome({ operationType });
  if (result.outcome === QUERY_OUTCOME.SUCCEEDED) return { kind: 'succeeded', data: result.data };
  if (result.outcome === QUERY_OUTCOME.FAILED || result.outcome === QUERY_OUTCOME.NO_PENDING) {
    return { kind: 'failed', data: result.data };
  }
  return { kind: 'processing', data: result.data };
}

/** 写结果归一成极短提示：错误码与规则解释不上屏，只留状态与动作。 */
function toWriteNotice(result) {
  const output = result || {};
  if (output.outcome === WRITE_OUTCOME.SUCCEEDED) return { kind: 'succeeded', text: '已提交' };
  if (output.outcome === WRITE_OUTCOME.UNKNOWN) return { kind: 'pending', text: '结果待确认' };
  if (output.outcome === WRITE_OUTCOME.CONFLICT) return { kind: 'conflict', text: '状态已变化' };
  if (output.bizCode === BIZ_CODE.PERMISSION_DENIED) return { kind: 'failed', text: '无权操作' };
  if (output.bizCode === BIZ_CODE.RESOURCE_NOT_FOUND) return { kind: 'failed', text: '事项不存在' };
  if (typeof output.notice === 'string' && output.notice) {
    return { kind: 'failed', text: output.notice };
  }
  return { kind: 'failed', text: '操作未能完成' };
}

module.exports = {
  OPERATION,
  FACT_RESULT,
  loadCase,
  submitDecision,
  submitCorrection,
  queryOutcomeOf,
  toWriteNotice,
};

/**
 * 公开与资料处理域入口（P11）。
 *
 * 页面只 require 本文件。
 *
 * 停止/恢复是业务事实命令：一次用户意图一个键，结果未知时保留原键查询，
 * 不换键重发 —— 换键会让「停止公开」与「恢复公开」的状态来回抖。
 *
 * PROFILE_REQUIRED 是本域唯一需要专门引导的错误：资料没生效时不能恢复公开，
 * 页面的正确反应是引导去 P07 补齐，而不是提示用户重试。
 */
const publicationApi = require('../../api/vendor-publication');
const profile = require('../profile');
const { BIZ_CODE, OPERATION_TYPE } = require('../../config/contracts');
const { WRITE_OUTCOME } = require('../../utils/failure');
const { runWrite, queryOutcome, QUERY_OUTCOME } = require('../submission');
const mapper = require('./mapper');
const copy = require('./copy');

const ACTION = copy.ACTION;

const NO_VENDOR_COPY = Object.freeze({
  title: '还不是摊主',
  description: '请先提交摊主资料',
  actionText: '去申请资料',
});

/** 资料状态失败不让整页失败：公开控制才是本页主内容，资料区单独降级。 */
async function loadProfileModel() {
  try {
    const loaded = await profile.loadProfile();
    return loaded && loaded.model ? loaded.model : null;
  } catch (error) {
    return null;
  }
}

async function loadPublication() {
  let response;
  try {
    response = await publicationApi.getPublication();
  } catch (error) {
    if (error && error.bizCode === BIZ_CODE.RESOURCE_NOT_FOUND) {
      return { noVendor: true, emptyCopy: { ...NO_VENDOR_COPY }, model: null };
    }
    throw error;
  }
  const profileModel = await loadProfileModel();
  return {
    noVendor: false,
    model: mapper.toPublicationModel((response && response.data) || {}, profileModel),
  };
}

function operationTypeOf(action) {
  if (action === ACTION.STOP) return OPERATION_TYPE.PUBLICATION_STOP;
  if (action === ACTION.RESUME) return OPERATION_TYPE.PUBLICATION_RESUME;
  return '';
}

/**
 * 停止或恢复本人公开。
 * @param {string} action copy.ACTION
 * @param {object} params
 * @param {number} params.expectedSelfVersion 读模型里的 selfVersion
 */
function runAction(action, { expectedSelfVersion } = {}) {
  const operationType = operationTypeOf(action);
  if (!operationType) {
    return Promise.resolve({ outcome: WRITE_OUTCOME.FAILED, message: '未知的操作类型' });
  }
  const execute = ({ idempotencyKey }) => (
    action === ACTION.STOP
      ? publicationApi.stopPublication({ expectedSelfVersion }, { idempotencyKey })
      : publicationApi.resumePublication({ expectedSelfVersion }, { idempotencyKey })
  );
  return runWrite({ operationType, execute });
}

/**
 * 结果未知时按原键查结果。NO_PENDING 归为 failed（可安全重新发起），
 * 归成 processing 会让用户永远等一个不存在的操作。
 */
async function queryAction(action) {
  const operationType = operationTypeOf(action);
  if (!operationType) return { kind: 'failed' };
  const result = await queryOutcome({ operationType });
  if (result.outcome === QUERY_OUTCOME.SUCCEEDED) return { kind: 'succeeded', data: result.data };
  if (result.outcome === QUERY_OUTCOME.FAILED || result.outcome === QUERY_OUTCOME.NO_PENDING) {
    return { kind: 'failed', data: result.data };
  }
  return { kind: 'processing' };
}

module.exports = {
  ACTION,
  OPERATION_TYPE,
  NO_VENDOR_COPY,
  loadPublication,
  runAction,
  queryAction,
  // 写结果解读在 outcome.js：index.js 有 150 行上限，判断本身仍属于业务侧
  toOutcomeView: require('./outcome').toOutcomeView,
  confirmCopy: copy.confirmCopy,
  successTip: copy.successTip,
};

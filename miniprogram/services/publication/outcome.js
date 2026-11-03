/**
 * 公开写结果的解读（P11）。
 *
 * 单独成文件的原因：index.js 有 150 行上限，而这段判断又确实属于业务侧
 * （要按 bizCode 区分 PROFILE_REQUIRED 与一般失败）。
 *
 * PROFILE_REQUIRED 是唯一需要引导去补齐资料的情况：
 * 把它当"重试就能好"的失败，用户会一直点恢复公开。
 */
const { BIZ_CODE } = require('../../config/contracts');
const { WRITE_OUTCOME } = require('../../utils/failure');
const copy = require('./copy');

/**
 * @param {string} action copy.ACTION
 * @param {object} result services/submission.runWrite 的返回
 * @returns {{kind:string, message:string, reload:boolean, unknownVisible:boolean}}
 */
function toOutcomeView(action, result) {
  const outcome = result && result.outcome;
  if (outcome === WRITE_OUTCOME.SUCCEEDED) {
    return {
      kind: 'succeeded',
      message: copy.successTip(action),
      reload: true,
      unknownVisible: false,
    };
  }
  if (outcome === WRITE_OUTCOME.UNKNOWN) {
    return {
      kind: 'unknown',
      message: '网络中断，尚不确定本次操作是否成立，请先查看最新结果。',
      reload: false,
      unknownVisible: true,
    };
  }
  if (outcome === WRITE_OUTCOME.CONFLICT) {
    return {
      kind: 'conflict',
      message: (result && result.message) || '状态已变化，请查看最新结果后重试。',
      reload: true,
      unknownVisible: true,
    };
  }
  if (result && result.bizCode === BIZ_CODE.PROFILE_REQUIRED) {
    return {
      kind: 'profile-required',
      message: '当前没有生效中的摊主资料，先补齐资料并通过审核才能恢复公开。',
      reload: true,
      unknownVisible: false,
    };
  }
  return {
    kind: 'failed',
    message: (result && result.message) || '操作未能完成',
    reload: false,
    unknownVisible: false,
  };
}

module.exports = { toOutcomeView };

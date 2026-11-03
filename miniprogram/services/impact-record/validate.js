/**
 * 复核说明校验（P13）。
 *
 * 与后端 impact/schema.js 同口径：必填、按 Unicode 码点计长度、拒绝控制字符。
 * 前端先拦一道只是省一次往返，服务端仍会独立校验。
 */
const { IMPACT_REVIEW_STATEMENT_MAX } = require('../../config/contracts');

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

function codepointLength(text) {
  return Array.from(text).length;
}

const REASON_TEXT = Object.freeze({
  REQUIRED: '请填写复核说明',
  TOO_LONG: `复核说明不能超过 ${IMPACT_REVIEW_STATEMENT_MAX} 字`,
  CONTROL_CHARACTER: '包含不可见字符',
});

/**
 * @param {string} reason
 * @returns {{ok:boolean, value:string, error:string}}
 */
function validateReason(reason) {
  const value = typeof reason === 'string' ? reason.trim() : '';
  if (!value) return { ok: false, value: '', error: REASON_TEXT.REQUIRED };
  if (CONTROL_CHARACTERS.test(value)) return { ok: false, value, error: REASON_TEXT.CONTROL_CHARACTER };
  if (codepointLength(value) > IMPACT_REVIEW_STATEMENT_MAX) {
    return { ok: false, value, error: REASON_TEXT.TOO_LONG };
  }
  return { ok: true, value, error: '' };
}

module.exports = { validateReason, codepointLength, REASON_TEXT, IMPACT_REVIEW_STATEMENT_MAX };

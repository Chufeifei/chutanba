/**
 * 摊主资料表单校验（P08）。
 *
 * 口径必须与后端 backend/src/modules/profile/schema.js 完全一致，
 * 否则会出现「前端过了、后端 400」或「前端拦了、后端其实允许」的两种漂移。
 * 后端已确认（G-01，2026-11-02）：五项文字**全部必填**，公告也不例外。
 *
 * 长度按 Unicode 码点计（Array.from），不是 UTF-16 长度 ——
 * 一个 emoji 在后端算 1 个字符，前端用 .length 会算成 2。
 */
const { PROFILE_LIMITS } = require('../../config/contracts');
const { CATEGORY_ITEMS } = require('../../config/categories');

// 与后端 schema.js 的 CONTROL_CHARACTERS 保持一致（含 C1 控制区）
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;
// 后端拒绝 HTML 标记字符，避免资料里塞标签
const MARKUP_CHARACTERS = /[<>]/;

const CATEGORY_CODES = CATEGORY_ITEMS.map((item) => item.code);

const FIELD_LIMITS = Object.freeze({
  vendorName: PROFILE_LIMITS.VENDOR_NAME_MAX,
  regularItemsText: PROFILE_LIMITS.REGULAR_ITEMS_MAX,
  priceDescription: PROFILE_LIMITS.PRICE_DESCRIPTION_MAX,
  announcement: PROFILE_LIMITS.ANNOUNCEMENT_MAX,
});

// 字段中文名，用于把服务端返回的 fields 定位到表单项
const FIELD_LABELS = Object.freeze({
  vendorName: '名称',
  categoryCode: '品类',
  regularItemsText: '常卖内容',
  priceDescription: '价格说明',
  announcement: '公告',
});

function codePointLength(text) {
  return Array.from(text).length;
}

/** 单个文本字段的校验，返回 { value, error }。error 为空表示通过。 */
function checkText(raw, field) {
  if (typeof raw !== 'string') return { value: '', error: '请填写该项' };
  const trimmed = raw.trim();
  if (!trimmed) return { value: '', error: '请填写该项' };
  if (codePointLength(trimmed) > FIELD_LIMITS[field]) {
    return { value: trimmed, error: `最多 ${FIELD_LIMITS[field]} 个字` };
  }
  if (CONTROL_CHARACTERS.test(trimmed)) return { value: trimmed, error: '包含不可见字符' };
  if (MARKUP_CHARACTERS.test(trimmed)) return { value: trimmed, error: '不能包含尖括号' };
  return { value: trimmed, error: '' };
}

function checkCategory(raw) {
  const code = typeof raw === 'string' ? raw.trim() : '';
  if (!code) return { value: '', error: '请选择品类' };
  if (!CATEGORY_CODES.includes(code)) return { value: code, error: '品类不可用，请重新选择' };
  return { value: code, error: '' };
}

/**
 * 校验并归一化资料表单。
 * @param {object} form 五项文字
 * @returns {{ok: boolean, errors: object, normalized: object}}
 *   errors 的键是字段名，值是给用户看的中文原因。
 */
function validateProfileForm(form = {}) {
  const errors = {};
  const normalized = {};

  const name = checkText(form.vendorName, 'vendorName');
  const category = checkCategory(form.categoryCode);
  const items = checkText(form.regularItemsText, 'regularItemsText');
  const price = checkText(form.priceDescription, 'priceDescription');
  const announcement = checkText(form.announcement, 'announcement');

  if (name.error) errors.vendorName = name.error;
  if (category.error) errors.categoryCode = category.error;
  if (items.error) errors.regularItemsText = items.error;
  if (price.error) errors.priceDescription = price.error;
  if (announcement.error) errors.announcement = announcement.error;

  normalized.vendorName = name.value;
  normalized.categoryCode = category.value;
  normalized.regularItemsText = items.value;
  normalized.priceDescription = price.value;
  normalized.announcement = announcement.value;

  return { ok: Object.keys(errors).length === 0, errors, normalized };
}

/** 把校验错误转成后端同形状的 fields 列表，便于统一交给表单定位。 */
function toFieldErrors(errors = {}) {
  return Object.keys(errors).map((field) => ({ field, reason: errors[field] }));
}

// 服务端返回的 reason 是代码，本地校验给的是中文原文。
// 这里只翻译代码，遇到中文原文原样返回，两种来源用同一套文案。
const REASON_TEXT = Object.freeze({
  EMPTY: '请填写该项',
  TOO_LONG: '超过长度上限',
  CONTROL_CHARACTER: '包含不可见字符',
  INVALID_CHARACTER: '不能包含尖括号',
  UNKNOWN_CATEGORY: '品类不可用，请重新选择',
  OUT_OF_RANGE: '取值超出范围',
  INVALID_TYPE: '格式不正确',
  UNKNOWN_FIELD: '包含不支持的内容',
});

function reasonTextOf(reason) {
  if (!reason) return '填写内容需要修改';
  return REASON_TEXT[reason] || reason;
}

module.exports = {
  FIELD_LABELS,
  FIELD_LIMITS,
  REASON_TEXT,
  validateProfileForm,
  toFieldErrors,
  reasonTextOf,
};

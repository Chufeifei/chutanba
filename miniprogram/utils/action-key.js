/**
 * 操作键（Idempotency-Key）生成与本地暂存。
 *
 * 规则（技术设计 §4.3）：
 * - 一次用户确认的写入意图生成一个稳定键；
 * - 同一次网络重试、重复点击、结果未知后的查询，复用同一个键；
 * - 只有用户明确再次决定时，才生成新键。
 *
 * 本地暂存只保存"键 + 操作类型 + 时间"，不保存坐标、证据或表单内容 ——
 * 那些一旦落盘就成了不受控的个人信息副本。
 */
const timing = require('../config/timing');

const STORAGE_PREFIX = 'mvp.operation.';
// 键体只允许 ASCII 字母数字与 ._:- ，与后端校验规则一致
const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

function randomToken() {
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 16);
}

/**
 * @param {string} operationType 操作类型，如 'session-open' / 'feedback-submit'
 * @returns {string} 可直接放入 Idempotency-Key 的键
 */
function generateKey(operationType) {
  const prefix = String(operationType || 'wx').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 20) || 'wx';
  const key = `${prefix}:${Date.now()}:${randomToken()}`.slice(0, 64);
  if (!KEY_PATTERN.test(key)) {
    throw new TypeError('生成的操作键不符合后端校验规则');
  }
  return key;
}

/** 取出未过期的待确认键；过期即清理，避免用旧键重放早已结束的意图。 */
function peekKey(operationType) {
  const storageKey = `${STORAGE_PREFIX}${operationType}`;
  const saved = wx.getStorageSync(storageKey);
  if (!saved || !saved.key || !KEY_PATTERN.test(saved.key)) {
    wx.removeStorageSync(storageKey);
    return null;
  }
  if (Date.now() - Number(saved.createdAtMs || 0) > timing.OPERATION_KEY_TTL_MS) {
    wx.removeStorageSync(storageKey);
    return null;
  }
  return saved.key;
}

function saveKey(operationType, key) {
  if (!KEY_PATTERN.test(key)) throw new TypeError('操作键格式不正确');
  wx.setStorageSync(`${STORAGE_PREFIX}${operationType}`, { key, createdAtMs: Date.now() });
}

function clearKey(operationType) {
  wx.removeStorageSync(`${STORAGE_PREFIX}${operationType}`);
}

/**
 * 取得本次意图应使用的键：优先复用未确认的旧键（网络重试场景），
 * 没有则新建并落盘。
 */
function acquireKey(operationType) {
  const existing = peekKey(operationType);
  if (existing) return { key: existing, reused: true };
  const key = generateKey(operationType);
  saveKey(operationType, key);
  return { key, reused: false };
}

module.exports = { generateKey, acquireKey, peekKey, saveKey, clearKey, KEY_PATTERN };

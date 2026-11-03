/**
 * 出摊记录读模型（P10）。
 *
 * 服务端按上海当地日分组后下发，这里只做展示整形：
 * - openDate 是 YYYY-MM-DD 字符串，不是时间戳；
 * - lastEndedAtMs 在「当日仍有未结束轮次」时整个键缺失（后端用展开语法省略），
 *   所以判断必须走 == null，不能靠真值。
 */
const { formatMoment, formatOpenDate, formatCount } = require('../../utils/formatter');

// 需求 F04 的跨日说明：同日多次开摊记一天，跨零点不自动加次日
const NOTICE_TEXT = '同日多次开摊记一天；连续跨过零点不自动增加次日记录。';

function toDayItem(row) {
  const source = row || {};
  const hasLastEnded = source.lastEndedAtMs !== null && source.lastEndedAtMs !== undefined;
  const sessionCount = Number(source.sessionCount);
  return {
    openDate: source.openDate ? String(source.openDate) : '',
    dateText: formatOpenDate(source.openDate),
    sessionCountText: `${Number.isFinite(sessionCount) && sessionCount > 0 ? sessionCount : 0} 次营业`,
    firstStartedText: formatMoment(source.firstStartedAtMs),
    lastEndedText: hasLastEnded ? formatMoment(source.lastEndedAtMs) : '',
    hasLastEnded,
  };
}

/**
 * @param {object} raw GET /vendor/open-days 的 data
 */
function toOpenDaysModel(raw) {
  const source = raw || {};
  const rows = Array.isArray(source.rows) ? source.rows : [];
  const totalDays = Number(source.totalDays);
  return {
    totalDays: Number.isFinite(totalDays) && totalDays > 0 ? totalDays : 0,
    totalDaysText: formatCount(Number.isFinite(totalDays) ? totalDays : 0, '天'),
    noticeText: NOTICE_TEXT,
    days: rows.map(toDayItem),
    hasRecords: rows.length > 0,
    nextCursor: source.nextCursor ? String(source.nextCursor) : '',
  };
}

/** 追加下一页：累计天数与跨日说明不变，只把新的一天接在后面。 */
function appendPage(previousModel, nextModel) {
  if (!previousModel) return nextModel;
  if (!nextModel) return previousModel;
  return {
    ...nextModel,
    days: previousModel.days.concat(nextModel.days),
    hasRecords: previousModel.days.length + nextModel.days.length > 0,
  };
}

module.exports = { NOTICE_TEXT, toDayItem, toOpenDaysModel, appendPage };

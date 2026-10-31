/**
 * 平台业务时区。固定为 Asia/Shanghai，不随普通运营调整。
 * 自然日、预约、请假、出摊日、公开期截止与跨日判断均使用该时区。
 */
const BUSINESS_TIMEZONE = 'Asia/Shanghai';

/** 公开期默认长度：自最后一次成功营业定位时刻起第 7 日相同本地时刻。 */
const PUBLIC_PERIOD_DAYS = 7;

module.exports = { BUSINESS_TIMEZONE, PUBLIC_PERIOD_DAYS };

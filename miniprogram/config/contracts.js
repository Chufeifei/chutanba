/**
 * 一期业务枚举与错误码单一来源（对外的唯一入口）。
 *
 * 约束：
 * 1. 这里的值必须与后端契约一致（doc/MVP/一期数据模型与接口约定.md §3、§6）；
 * 2. 页面与 service 不得就地写字面量，缺枚举先补这里；
 * 3. 只放常量，不放判断逻辑 —— 判断属于 services/。
 *
 * 内容按业务面拆到 ./contracts/ 下的子文件，本文件只做汇总，
 * 因此 require('../config/contracts') 的调用方无需改动，也不要直连子文件。
 */
module.exports = Object.assign(
  {},
  require('./contracts/session'),
  require('./contracts/profile'),
  require('./contracts/feedback'),
  require('./contracts/authorization'),
  require('./contracts/clearance'),
  require('./contracts/impact'),
);

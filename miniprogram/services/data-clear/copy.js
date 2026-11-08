/**
 * P12 文案与状态色调。
 *
 * 最关键的一条口径：**已隐藏不等于已清除**。
 * hiddenKinds 是请求成立即隐藏的类别，processedKinds 才是真正去标识化的类别，
 * 两者必须分开表述，任何"已删除""永久注销"的说法都是错的。
 */
const TIP = Object.freeze({
  PREVIEW_FAILED: '暂时无法获取可清除范围，请稍后重试',
  NEED_EXPLICIT_ALL: '请改选全部资料',
  ACCOUNT_VERSION_FAILED: '无法确认账号最新状态，请重试',
  SUBMITTED: '清除请求已成立',
  KEEP_OLD_SCOPE: '请先查看清除范围再提交',
});

function previewHint(preview) {
  if (!preview) return TIP.PREVIEW_FAILED;
  if (preview.requiresExplicitAll) return TIP.NEED_EXPLICIT_ALL;
  return '';
}

/** 请求成立后的确认文案：成立时刻 + 最迟处理时刻，不用"已完成"。 */
function submittedText(model) {
  const parts = ['请求已成立'];
  if (model && model.retention.length) {
    parts.push('部分记录需保留');
  }
  return parts.join('');
}

/** 确认弹层：账号与影响由页面另行显示，这里只汇总范围与期限。 */
function confirmCopy(preview) {
  if (!preview) {
    return { title: '确认清除资料', description: '', confirmText: '确认提交' };
  }
  const parts = [`清除范围：${preview.scopeLabel}`];
  if (preview.activeSession.willEnd) parts.push('当前营业轮次会立即结束');
  parts.push(preview.retention.length
    ? `必要保留：${preview.retention.length} 类记录`
    : '没有需要保留的记录');
  if (preview.dueText) parts.push(`最迟处理：${preview.dueText}`);
  return {
    title: '确认清除资料',
    description: parts.join('；'),
    confirmText: '确认提交清除请求',
  };
}

module.exports = { TIP, previewHint, confirmCopy };

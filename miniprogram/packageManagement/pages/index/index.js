/**
 * 管理分包首页。
 *
 * 入口数据经 services/management 编排层真实读取：加载中、空、失败分别有呈现，
 * 四个入口跳转保持已注册页面不变，且各自带上目标页 onLoad 所需的对象标识。
 * 标识一律取自对应队列列表首项；列表为空或读取失败时降级为禁用入口，不拼空参数。
 */
const management = require('../../../services/management');
const governance = require('../../../services/management/governance');
const feedbackApi = require('../../../api/management-feedback');
const impactApi = require('../../../api/management-impact');

/** 入口标识统一转码；空值返回空串，由视图降级为禁用入口。 */
function toEntryId(value) {
  const id = value === undefined || value === null ? '' : String(value).trim();
  return id ? encodeURIComponent(id) : '';
}

/** 走已有 api 封装取列表首项标识；任何失败或空列表都返回空串。 */
function firstRowId(task, field) {
  return Promise.resolve()
    .then(task)
    .then((response) => {
      const rows = (response && response.data && response.data.rows) || [];
      return rows.length ? toEntryId(rows[0] && rows[0][field]) : '';
    })
    .catch(() => '');
}

Page({
  data: {
    viewState: 'loading',
    statusText: '正在加载',
    counts: { profileReviews: '—', fieldFeedback: '—', impactReviews: '—' },
    isEmpty: false,
    tasks: [],
    tip: '',
    // 四个入口各自的目标对象标识，参数名对齐目标页 onLoad：
    // 资料审核 / 资料复核读 id、现场复核读 caseId、治理处理读 vendorId。
    profileEntryId: '',
    fieldEntryId: '',
    impactEntryId: '',
    governanceVendorId: '',
  },

  onLoad() {
    this.load();
  },

  onReloadTap() {
    this.load();
  },

  async load() {
    this.setData({
      viewState: 'loading',
      tip: '',
      profileEntryId: '',
      fieldEntryId: '',
      impactEntryId: '',
      governanceVendorId: '',
    });
    const result = await management.loadEntryData();
    if (!result.ok) {
      this.setData({ viewState: 'failed', tip: result.tip || '暂时未能完成' });
      return;
    }
    this.setData({
      viewState: 'content',
      statusText: result.statusText,
      counts: result.counts,
      isEmpty: result.isEmpty,
      tasks: result.tasks,
      tip: '',
      // 资料审核入口复用入口数据里的任务列表首项 submissionId
      profileEntryId: toEntryId(result.tasks.length ? result.tasks[0].id : ''),
    });
    this.loadEntryIds();
  },

  /**
   * 补齐其余三个入口的列表首项标识，全部走已有 api/编排层封装并显式标注。
   * 现场复核取 listFieldFeedbackCases 的 caseId，资料复核取 listImpactReviews 的
   * impactReviewId，治理处理沿用 loadGovernanceVendors 的 vendorId。
   * 任一列表为空或读取失败都保持空串，由 wxml 降级为禁用入口。
   */
  async loadEntryIds() {
    const [field, impact, governanceResult] = await Promise.all([
      firstRowId(() => feedbackApi.listFieldFeedbackCases({ status: 'PENDING', limit: '1' }), 'caseId'),
      firstRowId(() => impactApi.listImpactReviews({ status: 'PENDING', limit: '1' }), 'impactReviewId'),
      governance.loadGovernanceVendors().catch(() => null),
    ]);
    const vendors = governanceResult && governanceResult.ok ? governanceResult.vendors : [];
    this.setData({
      fieldEntryId: field,
      impactEntryId: impact,
      governanceVendorId: vendors.length ? toEntryId(vendors[0].vendorId) : '',
    });
  },
});

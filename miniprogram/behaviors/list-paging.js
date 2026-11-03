/**
 * 游标分页追加（P10 出摊记录 / P12 清除进度 / P13 处理记录共用）。
 *
 * 与 `live-refresh` 同一写法：页面传 fetcher 与回调，behavior 只提供"再取一页"的状态与方法。
 *
 * 为什么用游标而不是页码：一期三个列表接口都返回 `nextCursor`（`open-days`、`data-clear-requests`、
 * `impact-records`），游标天然不受并发插入影响；页码在"新记录插到前面"时会重复或漏项。
 *
 * 两个容易做错的点，本文件已处理：
 * 1. **追加不是替换**：上一页必须保留，否则点一次「加载更多」就丢了前面几页。
 *    追加由 services 域的 appendPage / appendRecords 完成，behavior 不重排数据；
 * 2. **失败不清空**：只提示，不把已有列表变空。
 *
 * 使用方式（页面引入 ../../behaviors/list-paging.js 后）：
 *   behaviors: [listPaging]
 *   onLoadMore() {
 *     return this.loadMorePage({
 *       nextCursor: this.data.model && this.data.model.nextCursor,
 *       fetcher: (cursor) => service.load({ cursor, previous: this.data.model }),
 *       onResult: (next) => this.setData({ model: next }),
 *     });
 *   }
 *
 * data 字段统一加 `list` 前缀，避免与其他 behavior 的字段静默覆盖。
 */
module.exports = Behavior({
  data: {
    listLoading: false,
  },

  methods: {
    /**
     * @param {object} params
     * @param {string} params.nextCursor 没有更多时传空值，方法直接返回
     * @param {function} params.fetcher 接收 cursor，返回下一页的读模型
     * @param {function} params.onResult 接收读模型，由页面决定写到哪个 data 键
     * @param {string} [params.failureText] 失败提示
     */
    async loadMorePage({ nextCursor, fetcher, onResult, failureText = '加载失败，请稍后重试' }) {
      if (this.data.listLoading || !nextCursor) return;
      this.setData({ listLoading: true });
      try {
        const result = await fetcher(nextCursor);
        if (typeof onResult === 'function') onResult.call(this, result);
      } catch (error) {
        wx.showToast({ title: failureText, icon: 'none' });
      }
      this.setData({ listLoading: false });
    },
  },
});

/**
 * 表单提交的可见状态机。
 *
 * 只处理"提交按下去之后，界面该显示什么"，不碰数据来源 ——
 * 真正的写命令编排在 services/submission，页面把 submitter 传进来即可。
 *
 * 这样 P08（资料）、P09（开摊/刷新/收摊）、P12（清除）、P15～P18（审核与治理）
 * 六个页面的提交状态不会各写一套，也不会漏掉"结果未知"这个分支。
 */
const { WRITE_OUTCOME } = require('../utils/failure');

const SUBMIT_STATE = Object.freeze({
  IDLE: 'idle',
  PENDING: 'submit-pending',
  UNKNOWN: 'submit-unknown',
  CONFLICT: 'submit-conflict',
  INVALID: 'submit-invalid',
  FAILED: 'submit-failed',
  SUCCEEDED: 'submit-succeeded',
});

module.exports = Behavior({
  data: {
    submitState: SUBMIT_STATE.IDLE,
    submitMessage: '',
    submitFields: [],
  },

  methods: {
    /**
     * @param {object} params
     * @param {function} params.submitter 返回 services/submission.runWrite 结果
     * @param {function} [params.onSuccess] 成功回调，参数为 data
     * @param {function} [params.onUnknown] 结果未知回调，页面据此提示"待确认"并提供查询入口
     */
    async runFormSubmit({ submitter, onSuccess, onUnknown }) {
      if (typeof submitter !== 'function') {
        throw new TypeError('runFormSubmit 需要 submitter');
      }
      // 处理中禁止重复点击：重复提交会消耗一个新意图，产生第二条业务结果
      if (this.data.submitState === SUBMIT_STATE.PENDING) return null;

      this.setData({ submitState: SUBMIT_STATE.PENDING, submitMessage: '', submitFields: [] });

      let result;
      try {
        result = await submitter();
      } catch (error) {
        // submitter 自身抛错（如缺参数），按明确失败处理，不进入"未知"
        this.setData({
          submitState: SUBMIT_STATE.FAILED,
          submitMessage: (error && error.message) || '操作未能完成',
        });
        return null;
      }

      switch (result && result.outcome) {
        case WRITE_OUTCOME.SUCCEEDED:
          this.setData({ submitState: SUBMIT_STATE.SUCCEEDED, submitMessage: '' });
          if (onSuccess) onSuccess(result.data, result);
          return result;

        case WRITE_OUTCOME.UNKNOWN:
          // 键已由 submission 保留，页面必须给"查看最新结果"入口
          this.setData({
            submitState: SUBMIT_STATE.UNKNOWN,
            submitMessage: '网络中断，尚不确定本次操作是否成立',
          });
          if (onUnknown) onUnknown(result);
          return result;

        case WRITE_OUTCOME.CONFLICT:
          this.setData({
            submitState: SUBMIT_STATE.CONFLICT,
            submitMessage: result.message || '状态已变化，请查看最新结果',
          });
          return result;

        case WRITE_OUTCOME.INVALID:
          // 字段错误必须回到原表单项，并保留用户已输入内容
          this.setData({
            submitState: SUBMIT_STATE.INVALID,
            submitMessage: result.message || '填写内容需要修改',
            submitFields: Array.isArray(result.fields) ? result.fields : [],
          });
          return result;

        default:
          this.setData({
            submitState: SUBMIT_STATE.FAILED,
            submitMessage: result && result.message ? result.message : '操作未能完成',
          });
          return result;
      }
    },

    resetSubmitState() {
      this.setData({ submitState: SUBMIT_STATE.IDLE, submitMessage: '', submitFields: [] });
    },

    isSubmitting() {
      return this.data.submitState === SUBMIT_STATE.PENDING;
    },
  },
});

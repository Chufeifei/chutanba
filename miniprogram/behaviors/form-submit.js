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
    // 供 wxml 直接绑定的处理中标志：页面不必在业务状态字符串上做判断
    submitPending: false,
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

      this.setData({
        submitState: SUBMIT_STATE.PENDING,
        submitPending: true,
        submitMessage: '',
        submitFields: [],
      });

      let result;
      try {
        result = await submitter();
      } catch (error) {
        // submitter 自身抛错（如缺参数），按明确失败处理，不进入"未知"
        this.setData({
          submitState: SUBMIT_STATE.FAILED,
          submitPending: false,
          submitMessage: (error && error.message) || '操作未能完成',
        });
        return null;
      }
      // 处理中窗口就是 await 这一段，等待结束即解除处理中标志
      this.setData({ submitPending: false });

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
      this.setData({ submitState: SUBMIT_STATE.IDLE, submitPending: false, submitMessage: '', submitFields: [] });
    },

    /**
     * 表单有未提交内容时给返回键加确认提示，避免误退丢失已填文字。
     * 基础库不支持时静默跳过，不影响其余流程。
     * @param {object} form 表单内容，全为空视为没有未提交内容
     * @param {string} message 提示文案
     */
    applyLeaveGuard(form, message) {
      if (!wx.enableAlertBeforeUnload || !wx.disableAlertBeforeUnload) return;
      const dirty = Object.keys(form || {}).some((key) => String(form[key] || '').trim());
      if (dirty) {
        wx.enableAlertBeforeUnload({ message });
      } else {
        wx.disableAlertBeforeUnload();
      }
    },

    /** 提交成功或主动放弃时解除返回键提示。 */
    clearLeaveGuard() {
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
    },

    isSubmitting() {
      return this.data.submitState === SUBMIT_STATE.PENDING;
    },
  },
});

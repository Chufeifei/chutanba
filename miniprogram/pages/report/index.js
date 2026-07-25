const api = require('../../utils/api')

Page({
  data: {
    stallId: '',
    reasons: [
      '时间或地点不实',
      '商品或图片不实',
      '存在违法违规内容',
      '疑似诈骗或诱导转账',
      '食品安全风险',
      '其他问题'
    ],
    reason: '',
    detail: '',
    submitting: false
  },

  onLoad(options) {
    this.setData({ stallId: options.stallId || '' })
  },

  chooseReason(e) {
    this.setData({ reason: e.currentTarget.dataset.reason })
  },

  inputDetail(e) {
    this.setData({ detail: e.detail.value })
  },

  submit() {
    if (!this.data.reason) {
      wx.showToast({ title: '请选择举报原因', icon: 'none' })
      return
    }
    if (this.data.submitting) return
    this.setData({ submitting: true })
    api.call('report', {
      stallId: this.data.stallId,
      reason: this.data.reason,
      detail: this.data.detail.trim()
    }).then(() => {
      wx.showModal({
        title: '举报已提交',
        content: '平台会进行复核。感谢你帮助维护真实、安全的出摊信息。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    }).catch(err => {
      wx.showToast({ title: err.message || '提交失败', icon: 'none' })
    }).finally(() => this.setData({ submitting: false }))
  }
})

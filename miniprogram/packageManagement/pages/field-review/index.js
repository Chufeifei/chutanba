Page({
  data: {
    verifyState: 'CONFIRMED',
  },

  onVerifyTap(e) {
    this.setData({ verifyState: e.currentTarget.dataset.state });
  },

  onSubmitTap() {
    wx.showToast({ title: '已记录：提交处理', icon: 'none' });
  },

  onRejectTap() {
    wx.showToast({ title: '已记录：驳回', icon: 'none' });
  },
});

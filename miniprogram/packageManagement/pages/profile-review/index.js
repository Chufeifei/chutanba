Page({
  data: {},

  onApproveTap() {
    wx.showToast({ title: '已记录：通过', icon: 'none' });
  },

  onRejectTap() {
    wx.showToast({ title: '已记录：驳回', icon: 'none' });
  },
});

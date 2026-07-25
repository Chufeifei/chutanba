const api = require('../../utils/api')
const config = require('../../config')
const store = require('../../utils/store')
const tabbar = require('../../utils/tabbar')

Page({
  data: {
    loading: true,
    me: null,
    config
  },

  onLoad() {
    this.load(true).finally(() => {
      this.hasLoaded = true
    })
  },

  onShow() {
    tabbar.select(this, 4)

    if (this.hasLoaded && store.isDirty('me')) {
      this.load(false, true)
    }
  },

  load(showLoading = true, force = false) {
    if (showLoading) this.setData({ loading: true })

    return api.call('me', {}, { force }).then(me => {
      this.setData({
        me,
        loading: false
      })
    }).catch(err => {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    })
  },

  goVendor() {
    wx.navigateTo({ url: '/pages/vendor-edit/index' })
  },

  goMyStalls() {
    wx.navigateTo({ url: '/pages/my-stalls/index' })
  },

  goFavorites() {
    wx.switchTab({ url: '/pages/favorite/index' })
  },

  goLegal(e) {
    wx.navigateTo({ url: `/pages/legal/index?type=${e.currentTarget.dataset.type}` })
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/index' })
  },

  copyOpenid() {
    if (!this.data.me || !this.data.me.openid) return
    wx.setClipboardData({ data: this.data.me.openid })
  },

  feedback() {
    wx.showModal({
      title: '意见反馈',
      content: `请发送到 ${config.CONTACT_EMAIL}。`,
      showCancel: false
    })
  },

  about() {
    wx.showModal({
      title: '关于出摊吧',
      content: '一个帮助顾客找到摊主，也帮助摊主发布出摊时间与地点的信息工具。',
      showCancel: false
    })
  }
})

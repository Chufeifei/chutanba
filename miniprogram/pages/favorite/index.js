const api = require('../../utils/api')
const follow = require('../../utils/follow')
const privacy = require('../../utils/privacy')
const store = require('../../utils/store')
const tabbar = require('../../utils/tabbar')
const { dedupeStalls } = require('../../utils/stall-list')

Page({
  data: {
    loading: true,
    latitude: null,
    longitude: null,
    items: []
  },

  onLoad() {
    const location = store.getLocation()
    if (location) {
      this.setData({
        latitude: location.latitude,
        longitude: location.longitude
      })
    }

    this.load(true).finally(() => {
      this.hasLoaded = true
    })
  },

  onShow() {
    tabbar.select(this, 3)

    if (this.hasLoaded && store.isDirty('favorites')) {
      this.load(false, true)
    }
  },

  onPullDownRefresh() {
    this.load(false, true).finally(() => wx.stopPullDownRefresh())
  },

  load(showLoading = true, force = false) {
    if (showLoading) this.setData({ loading: true })

    return api.call('favoriteList', {
      latitude: this.data.latitude,
      longitude: this.data.longitude
    }, { force }).then(res => {
      this.setData({
        items: dedupeStalls(res.items || []),
        loading: false
      })
    }).catch(err => {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    })
  },

  locate() {
    privacy.getLocation().then(res => {
      store.setLocation(res)
      this.setData({
        latitude: res.latitude,
        longitude: res.longitude
      })
      return this.load(false, true)
    }).catch(() => {
      wx.showToast({ title: '未获得位置权限', icon: 'none' })
    })
  },

  openStall(e) {
    wx.navigateTo({ url: `/pages/detail/index?id=${e.detail.id}` })
  },

  favorite(e) {
    follow.toggle(e.detail.id, e.detail)
      .then(() => this.load(false, true))
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' })
  }
})

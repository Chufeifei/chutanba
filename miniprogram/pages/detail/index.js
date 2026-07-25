const api = require('../../utils/api')
const follow = require('../../utils/follow')
const privacy = require('../../utils/privacy')
const store = require('../../utils/store')

Page({
  data: {
    id: '',
    loading: true,
    item: null,
    latitude: null,
    longitude: null,
    reminding: false
  },

  onLoad(options) {
    const location = store.getLocation()
    this.setData({
      id: options.id || '',
      latitude: location ? location.latitude : null,
      longitude: location ? location.longitude : null
    })

    this.load(true).finally(() => {
      this.hasLoaded = true
    })
  },

  onShow() {
    if (this.hasLoaded && store.isDirty('detail')) {
      this.load(false, true)
    }
  },

  load(showLoading = true, force = false) {
    if (!this.data.id) return Promise.resolve()
    if (showLoading) this.setData({ loading: true })

    return api.call('getStall', {
      id: this.data.id,
      latitude: this.data.latitude,
      longitude: this.data.longitude
    }, { force }).then(res => {
      this.setData({
        item: res.item,
        loading: false
      })
      wx.setNavigationBarTitle({ title: res.item.name || '出摊详情' })
    }).catch(err => {
      this.setData({ loading: false })
      wx.showModal({
        title: '无法查看',
        content: err.message || '这条出摊信息可能已下架',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    })
  },

  locateAndReload() {
    privacy.getLocation().then(res => {
      store.setLocation(res)
      this.setData({
        latitude: res.latitude,
        longitude: res.longitude
      })
      return this.load(false, true)
    }).catch(() => wx.showToast({ title: '未获得位置权限', icon: 'none' }))
  },

  favorite() {
    follow.toggle(this.data.id, this.data.item || {})
      .then(() => this.load(false, true))
  },

  openLocation() {
    const item = this.data.item
    if (!item) return

    wx.openLocation({
      latitude: Number(item.location.latitude),
      longitude: Number(item.location.longitude),
      name: item.name,
      address: item.address,
      scale: 17
    })
  },

  remind() {
    const item = this.data.item
    if (!item || this.data.reminding) return

    if (!item.isFavorite) {
      wx.showModal({
        title: '先关注摊主',
        content: '关注摊主后，可以开启下一次出摊提醒。',
        confirmText: '关注并提醒',
        success: result => {
          if (!result.confirm) return
          this.setData({ reminding: true })
          follow.toggle(this.data.id, item)
            .then(() => this.load(false, true))
            .finally(() => this.setData({ reminding: false }))
        }
      })
      return
    }

    this.setData({ reminding: true })
    follow.requestSubscribe(item.vendorId, item.vendorName)
      .finally(() => this.setData({ reminding: false }))
  },

  report() {
    wx.navigateTo({ url: `/pages/report/index?stallId=${this.data.id}` })
  },

  preview(e) {
    const item = this.data.item
    wx.previewImage({
      current: e.currentTarget.dataset.url,
      urls: item.images
    })
  },

  onShareAppMessage() {
    const item = this.data.item
    return {
      title: item ? `${item.name}｜${item.timeText}` : '出摊吧',
      path: `/pages/detail/index?id=${this.data.id}`
    }
  }
})

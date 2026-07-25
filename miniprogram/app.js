const config = require('./config')
const api = require('./utils/api')

const DATA_CLEANUP_KEY = 'ctgl_cloud_data_cleaned_v5'
const ALERT_SEEN_KEY = 'ctgl_favorite_alerts_seen_v1'

App({
  globalData: {
    config,
    cloudReady: false,
    identity: null
  },

  onLaunch() {
    if (config.USE_CLOUD && wx.cloud) {
      wx.cloud.init({
        env: config.CLOUD_ENV || undefined,
        traceUser: true
      })

      this.globalData.cloudReady = true
      this.cleanupCloudData()
      this.bootstrapIdentity()
    }
  },

  onShow() {
    if (!this.globalData.cloudReady) return
    setTimeout(() => this.checkFavoriteAlerts(), 900)
    clearInterval(this.favoriteAlertTimer)
    this.favoriteAlertTimer = setInterval(() => this.checkFavoriteAlerts(), 60 * 1000)
  },

  onHide() {
    clearInterval(this.favoriteAlertTimer)
    this.favoriteAlertTimer = null
  },

  bootstrapIdentity() {
    api.call('me', {}, { force: true }).then(me => {
      this.globalData.identity = me
    }).catch(err => {
      console.warn('Identity bootstrap skipped:', err)
    })
  },

  cleanupCloudData() {
    if (wx.getStorageSync(DATA_CLEANUP_KEY)) return

    Promise.all([
      wx.cloud.callFunction({
        name: 'api',
        data: { action: 'cleanupLegacyDemo', data: {} }
      }),
      wx.cloud.callFunction({
        name: 'api',
        data: { action: 'cleanupDuplicateStalls', data: {} }
      })
    ]).then(() => {
      wx.setStorageSync(DATA_CLEANUP_KEY, true)
    }).catch(err => {
      console.warn('Cloud data cleanup skipped:', err)
    })
  },

  checkFavoriteAlerts() {
    if (this.alertChecking || this.alertVisible) return
    this.alertChecking = true

    api.call('favoriteDueAlerts', {}, { force: true }).then(res => {
      const now = Date.now()
      const stored = wx.getStorageSync(ALERT_SEEN_KEY)
      const seen = stored && typeof stored === 'object' ? stored : {}

      Object.keys(seen).forEach(key => {
        if (now - Number(seen[key] || 0) > 48 * 60 * 60 * 1000) delete seen[key]
      })

      const item = (res.items || []).find(stall => !seen[`${stall._id}_${stall.startAt}`])
      wx.setStorageSync(ALERT_SEEN_KEY, seen)
      if (!item) return

      const key = `${item._id}_${item.startAt}`
      seen[key] = now
      wx.setStorageSync(ALERT_SEEN_KEY, seen)
      this.alertVisible = true

      wx.showModal({
        title: '关注的摊主正在出摊',
        content: `${item.vendorName || '你关注的摊主'}：${item.name}\n${item.timeText}\n${item.address}`,
        confirmText: '查看摊位',
        cancelText: '稍后再看',
        success: result => {
          if (result.confirm) {
            wx.navigateTo({ url: `/pages/detail/index?id=${item._id}` })
          }
        },
        complete: () => {
          this.alertVisible = false
        }
      })
    }).catch(err => {
      console.warn('Favorite alert check skipped:', err)
    }).finally(() => {
      this.alertChecking = false
    })
  }
})

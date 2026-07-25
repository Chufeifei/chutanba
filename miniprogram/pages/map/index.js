const api = require('../../utils/api')
const follow = require('../../utils/follow')
const privacy = require('../../utils/privacy')
const store = require('../../utils/store')
const tabbar = require('../../utils/tabbar')
const { dedupeStalls } = require('../../utils/stall-list')

Page({
  data: {
    loading: true,
    latitude: 31.2304,
    longitude: 121.4737,
    scale: 13,
    stalls: [],
    markers: [],
    selected: null
  },

  onLoad() {
    const location = store.getLocation()

    if (location) {
      this.setData({
        latitude: location.latitude,
        longitude: location.longitude,
        scale: 14
      })
      this.load(true, true).finally(() => {
        this.hasLoaded = true
      })
      return
    }

    this.initLocation()
  },

  onShow() {
    tabbar.select(this, 1)

    if (this.hasLoaded && store.isDirty('stalls')) {
      this.load(true, false, true)
    }
  },

  initLocation() {
    privacy.getLocation().then(res => {
      store.setLocation(res)
      this.setData({
        latitude: res.latitude,
        longitude: res.longitude,
        scale: 14
      })
      return this.load(true, true)
    }).catch(() => {
      return this.load(false, true)
    }).finally(() => {
      this.hasLoaded = true
    })
  },

  load(useCurrent = true, showLoading = true, force = false) {
    if (showLoading) this.setData({ loading: true })

    return api.call('listStalls', {
      latitude: useCurrent ? this.data.latitude : null,
      longitude: useCurrent ? this.data.longitude : null
    }, { force }).then(res => {
      const stalls = dedupeStalls(res.items || [])
      const markers = stalls.map((item, index) => ({
        id: index + 1,
        stallId: item._id,
        latitude: item.location.latitude,
        longitude: item.location.longitude,
        iconPath: '/assets/pin.png',
        width: 36,
        height: 44,
        callout: {
          content: `${item.name}\n${item.statusText}`,
          color: '#49322c',
          fontSize: 12,
          borderRadius: 10,
          bgColor: '#fffdfb',
          padding: 8,
          display: 'BYCLICK'
        }
      }))

      const currentId = this.data.selected && this.data.selected._id
      const selected = stalls.find(item => item._id === currentId) || stalls[0] || null
      const update = {
        stalls,
        markers,
        selected,
        loading: false
      }

      if (selected && !useCurrent) {
        update.latitude = selected.location.latitude
        update.longitude = selected.location.longitude
      }

      this.setData(update)
    }).catch(err => {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '地图加载失败', icon: 'none' })
    })
  },

  locate(showTip = true) {
    privacy.getLocation().then(res => {
      store.setLocation(res)
      this.setData({
        latitude: res.latitude,
        longitude: res.longitude,
        scale: 14
      })
      return this.load(true, false, true)
    }).catch(() => {
      if (showTip) wx.showToast({ title: '未获得位置权限', icon: 'none' })
    })
  },

  onMarkerTap(e) {
    const marker = this.data.markers.find(item => item.id === e.detail.markerId)
    if (!marker) return

    const selected = this.data.stalls.find(item => item._id === marker.stallId)
    this.setData({ selected })
  },

  openStall(e) {
    wx.navigateTo({ url: `/pages/detail/index?id=${e.detail.id}` })
  },

  favorite(e) {
    follow.toggle(e.detail.id, e.detail)
      .then(() => this.load(true, false, true))
  },

  openLocation() {
    const item = this.data.selected
    if (!item) return

    wx.openLocation({
      latitude: Number(item.location.latitude),
      longitude: Number(item.location.longitude),
      name: item.name,
      address: item.address,
      scale: 17
    })
  }
})

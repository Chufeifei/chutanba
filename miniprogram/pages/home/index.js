const api = require('../../utils/api')
const follow = require('../../utils/follow')
const privacy = require('../../utils/privacy')
const store = require('../../utils/store')
const tabbar = require('../../utils/tabbar')
const { CATEGORY_OPTIONS } = require('../../utils/categories')
const { dedupeStalls } = require('../../utils/stall-list')

Page({
  data: {
    loading: true,
    locating: false,
    locationName: '定位后查看附近',
    latitude: null,
    longitude: null,
    keyword: '',
    activeCategory: '全部',
    openNow: false,
    features: [
      { key: 'nearby', label: '附近', sub: '按距离找摊', icon: '/assets/icons/nearby.png' },
      { key: 'open', label: '正出摊', sub: '只看营业中', icon: '/assets/icons/open-now.png' },
      { key: 'favorite', label: '关注', sub: '关注的摊主', icon: '/assets/icons/follow.png' },
      { key: 'vendor', label: '摊主', sub: '发布出摊', icon: '/assets/icons/vendor.png' }
    ],
    categories: [
      { value: '全部', icon: '/assets/icons/store.png' },
      ...CATEGORY_OPTIONS.filter(item => item.value !== '自定义')
    ],
    stalls: []
  },

  onLoad() {
    const location = store.getLocation()
    if (location) {
      this.setData({
        latitude: location.latitude,
        longitude: location.longitude,
        locationName: '已按当前位置排序'
      })
    }

    this.loadStalls(true).finally(() => {
      this.hasLoaded = true
    })
  },

  onShow() {
    tabbar.select(this, 0)

    if (this.hasLoaded && store.isDirty('stalls')) {
      this.loadStalls(false, true)
    }
  },

  onPullDownRefresh() {
    this.loadStalls(false, true).finally(() => wx.stopPullDownRefresh())
  },

  loadStalls(showLoading = true, force = false) {
    if (showLoading) this.setData({ loading: true })

    return api.call('listStalls', {
      latitude: this.data.latitude,
      longitude: this.data.longitude,
      keyword: this.data.keyword,
      category: this.data.activeCategory,
      openNow: this.data.openNow
    }, { force }).then(res => {
      this.setData({
        stalls: dedupeStalls(res.items || []),
        loading: false
      })
    }).catch(err => {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    })
  },

  featureTap(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'nearby') this.locate()
    if (key === 'open') this.toggleOpenNow()
    if (key === 'favorite') wx.switchTab({ url: '/pages/favorite/index' })
    if (key === 'vendor') wx.switchTab({ url: '/pages/publish/index' })
  },

  locate() {
    if (this.data.locating) return

    this.setData({ locating: true })

    privacy.getLocation().then(res => {
      store.setLocation(res)
      this.setData({
        latitude: res.latitude,
        longitude: res.longitude,
        locationName: '已按当前位置排序'
      })
      return this.loadStalls(false, true)
    }).catch(() => {
      wx.showModal({
        title: '需要位置权限',
        content: '开启定位后，才能优先展示离你更近的摊位。你也可以继续浏览全部出摊信息。',
        confirmText: '去设置',
        success(res) {
          if (res.confirm) wx.openSetting()
        }
      })
    }).finally(() => {
      this.setData({ locating: false })
    })
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  search() {
    this.loadStalls(false)
  },

  clearSearch() {
    this.setData({ keyword: '' })
    this.loadStalls(false)
  },

  chooseCategory(e) {
    this.setData({ activeCategory: e.currentTarget.dataset.value })
    this.loadStalls(false)
  },

  toggleOpenNow() {
    this.setData({ openNow: !this.data.openNow })
    this.loadStalls(false)
  },

  openStall(e) {
    wx.navigateTo({ url: `/pages/detail/index?id=${e.detail.id}` })
  },

  favorite(e) {
    follow.toggle(e.detail.id, e.detail)
      .then(() => this.loadStalls(false, true))
  },

  goPublish() {
    wx.switchTab({ url: '/pages/publish/index' })
  },

  onShareAppMessage() {
    return {
      title: '出摊吧｜看看附近今天谁出摊',
      path: '/pages/home/index'
    }
  }
})

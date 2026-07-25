const api = require('../../utils/api')
const store = require('../../utils/store')
const { dedupeStalls } = require('../../utils/stall-list')

Page({
  data: {
    loading: true,
    items: []
  },

  onLoad() {
    this.load(true).finally(() => {
      this.hasLoaded = true
    })
  },

  onShow() {
    if (this.hasLoaded && store.isDirty('myStalls')) {
      this.load(false, true)
    }
  },

  onPullDownRefresh() {
    this.load(false, true).finally(() => wx.stopPullDownRefresh())
  },

  load(showLoading = true, force = false) {
    if (showLoading) this.setData({ loading: true })

    return api.call('myStalls', {}, { force }).then(res => {
      this.setData({
        items: dedupeStalls(res.items || []),
        loading: false
      })
    }).catch(err => {
      this.setData({ loading: false })
      wx.showToast({ title: err.message || '加载失败', icon: 'none' })
    })
  },

  open(e) {
    wx.navigateTo({ url: `/pages/detail/index?id=${e.currentTarget.dataset.id}` })
  },

  setStatus(e) {
    const id = e.currentTarget.dataset.id
    const status = e.currentTarget.dataset.status
    const text = status === 'cancelled' ? '取消本场出摊' : '恢复本场出摊'

    wx.showModal({
      title: text,
      content: status === 'cancelled'
        ? '取消后顾客将看到“已取消”，请确认地点或时间确实有变化。'
        : '恢复后会重新按时间状态展示。',
      success: res => {
        if (!res.confirm) return
        api.call('setStallStatus', { id, status })
          .then(() => this.load(false, true))
      }
    })
  },

  remove(e) {
    const id = e.currentTarget.dataset.id

    wx.showModal({
      title: '删除出摊信息',
      content: '删除后无法恢复，确定继续吗？',
      confirmColor: '#e85b4b',
      success: res => {
        if (!res.confirm) return
        api.call('deleteStall', { id })
          .then(() => this.load(false, true))
      }
    })
  },

  publish() {
    wx.switchTab({ url: '/pages/publish/index' })
  }
})

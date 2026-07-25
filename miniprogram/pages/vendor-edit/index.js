const api = require('../../utils/api')
const privacy = require('../../utils/privacy')
const { CATEGORY_OPTIONS, findCategoryIndex } = require('../../utils/categories')

Page({
  data: {
    saving: false,
    categories: CATEGORY_OPTIONS,
    categoryIndex: 0,
    customMode: false,
    customCategory: '',
    avatarUrl: '',
    name: '',
    intro: '',
    defaultStallName: '',
    defaultDescription: '',
    defaultMenuText: '',
    defaultPriceText: '',
    defaultNotice: '',
    commonAddress: '',
    commonLocation: null
  },

  onLoad() {
    api.call('me').then(res => {
      const vendor = res.vendor || {}
      let categoryIndex = findCategoryIndex(vendor.defaultCategory)
      let customMode = false
      let customCategory = ''

      if (vendor.defaultCategory) {
        const matched = CATEGORY_OPTIONS.some(item => item.value === vendor.defaultCategory)
        if (!matched) {
          categoryIndex = CATEGORY_OPTIONS.length - 1
          customMode = true
          customCategory = vendor.defaultCategory
        } else {
          customMode = CATEGORY_OPTIONS[categoryIndex].value === '自定义'
        }
      }

      this.setData({
        avatarUrl: vendor.avatarUrl || '',
        name: vendor.name || '',
        intro: vendor.intro || '',
        defaultStallName: vendor.defaultStallName || '',
        defaultDescription: vendor.defaultDescription || '',
        defaultMenuText: vendor.defaultMenuText || '',
        defaultPriceText: vendor.defaultPriceText || '',
        defaultNotice: vendor.defaultNotice || '',
        commonAddress: vendor.commonAddress || '',
        commonLocation: vendor.commonLocation || null,
        categoryIndex,
        customMode,
        customCategory
      })
    })
  },

  input(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  inputCustomCategory(e) {
    this.setData({ customCategory: e.detail.value })
  },

  chooseCategory(e) {
    const categoryIndex = Number(e.currentTarget.dataset.index)
    this.setData({
      categoryIndex,
      customMode: CATEGORY_OPTIONS[categoryIndex].value === '自定义'
    })
  },

  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: res => this.setData({ avatarUrl: res.tempFiles[0].tempFilePath })
    })
  },

  chooseCommonPlace() {
    privacy.chooseLocation().then(res => {
      this.setData({
        commonAddress: res.address || res.name || '已选择位置',
        commonLocation: {
          latitude: res.latitude,
          longitude: res.longitude
        }
      })
    }).catch(() => {
      wx.showToast({ title: '未选择位置', icon: 'none' })
    })
  },

  getDefaultCategory() {
    const selected = CATEGORY_OPTIONS[this.data.categoryIndex]
    return this.data.customMode
      ? this.data.customCategory.trim()
      : selected.value
  },

  save() {
    if (!this.data.name.trim()) {
      wx.showToast({ title: '请填写摊主名称', icon: 'none' })
      return
    }
    if (!this.getDefaultCategory()) {
      wx.showToast({ title: '请填写自定义品类', icon: 'none' })
      return
    }

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中' })

    api.uploadFiles(this.data.avatarUrl ? [this.data.avatarUrl] : [], 'avatars')
      .then(files => api.call('saveVendor', {
        name: this.data.name.trim(),
        intro: this.data.intro.trim(),
        avatarUrl: files[0] || '',
        defaultStallName: this.data.defaultStallName.trim(),
        defaultCategory: this.getDefaultCategory(),
        defaultDescription: this.data.defaultDescription.trim(),
        defaultMenuText: this.data.defaultMenuText.trim(),
        defaultPriceText: this.data.defaultPriceText.trim(),
        defaultNotice: this.data.defaultNotice.trim(),
        commonAddress: this.data.commonAddress.trim(),
        commonLocation: this.data.commonLocation
      }))
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '已保存', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 500)
      })
      .catch(err => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '保存失败', icon: 'none' })
      })
      .finally(() => this.setData({ saving: false }))
  }
})

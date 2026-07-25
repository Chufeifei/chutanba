const api = require('../../utils/api')
const privacy = require('../../utils/privacy')
const dateUtil = require('../../utils/date')
const store = require('../../utils/store')
const tabbar = require('../../utils/tabbar')
const { CATEGORY_OPTIONS, findCategoryIndex } = require('../../utils/categories')

const DRAFT_KEY = 'ctgl_publish_draft_v2'
const DRAFT_MAX_AGE = 24 * 60 * 60 * 1000

function blankForm() {
  const defaults = dateUtil.defaultFormTime()
  return {
    name: '',
    description: '',
    menuText: '',
    priceText: '',
    notice: '',
    address: '',
    location: null,
    date: defaults.date,
    startTime: defaults.startTime,
    endTime: defaults.endTime,
    preciseDuringEvent: true
  }
}

function normalizeLocation(location) {
  if (!location) return null

  const rawLatitude = location.latitude
  const rawLongitude = location.longitude
  if (rawLatitude === null || rawLatitude === undefined || rawLatitude === '' ||
      rawLongitude === null || rawLongitude === undefined || rawLongitude === '') return null

  const latitude = Number(rawLatitude)
  const longitude = Number(rawLongitude)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null

  return { latitude, longitude }
}

function safeText(value) {
  return String(value || '').trim()
}

Page({
  data: {
    submitting: false,
    publishSucceeded: false,
    vendor: null,
    categories: CATEGORY_OPTIONS,
    categoryIndex: 0,
    customMode: false,
    customCategory: '',
    currentCategoryIcon: CATEGORY_OPTIONS[0].icon,
    images: [],
    hasPrefilled: false,
    form: blankForm()
  },

  onLoad() {
    this.submitLock = false
    this.publishRequestId = ''
    const draft = this.readDraft()

    if (draft) {
      this.setData(draft, () => this.loadVendor(false))
    } else {
      this.loadVendor(true)
    }
  },

  onShow() {
    tabbar.select(this, 2)

    const returnedFromVendorEditor = Boolean(this.shouldRefreshVendor)
    const vendorChanged = store.isDirty('vendor') || store.isDirty('me')
    const explicitlyEditedVendor = returnedFromVendorEditor && vendorChanged

    this.shouldRefreshVendor = false

    if (vendorChanged) {
      // 只有摊主资料确实保存发生变化时才覆盖表单。
      // 地图选择器关闭、取消资料编辑、导航切换等普通 onShow 不再重置内容。
      this.loadVendor(explicitlyEditedVendor)
    }
  },

  onUnload() {
    this.persistDraftNow()
  },

  loadVendor(forcePrefill = false) {
    this.pendingForcePrefill = Boolean(this.pendingForcePrefill || forcePrefill)

    if (this.vendorLoading) return this.vendorLoading

    this.vendorLoading = api.call('me', {}, { force: forcePrefill }).then(res => {
      const vendor = res.vendor || null
      const shouldForcePrefill = Boolean(this.pendingForcePrefill)
      this.pendingForcePrefill = false

      this.setData({ vendor })
      store.markClean('vendor')
      store.markClean('me')

      if (vendor && (shouldForcePrefill || !this.data.hasPrefilled)) {
        this.applyVendorDefaults(vendor)
      }
    }).catch(err => {
      console.error('[publish] load vendor failed', err)
      wx.showToast({ title: err.message || '摊主资料加载失败', icon: 'none' })
      return null
    }).finally(() => {
      this.vendorLoading = null
    })

    return this.vendorLoading
  },

  applyVendorDefaults(vendor = this.data.vendor, overwrite = false) {
    if (!vendor) return

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

    const current = this.data.form
    const commonLocation = normalizeLocation(vendor.commonLocation)
    const currentLocation = normalizeLocation(current.location)
    const shouldReplaceCategory = overwrite || !this.data.hasPrefilled

    this.setData({
      categoryIndex: shouldReplaceCategory ? categoryIndex : this.data.categoryIndex,
      customMode: shouldReplaceCategory ? customMode : this.data.customMode,
      customCategory: shouldReplaceCategory ? customCategory : this.data.customCategory,
      currentCategoryIcon: shouldReplaceCategory
        ? CATEGORY_OPTIONS[categoryIndex].icon
        : this.data.currentCategoryIcon,
      hasPrefilled: true,
      form: {
        name: overwrite || !safeText(current.name)
          ? (vendor.defaultStallName || `${vendor.name}今天出摊`)
          : current.name,
        description: overwrite || !safeText(current.description)
          ? (vendor.defaultDescription || vendor.intro || '')
          : current.description,
        menuText: overwrite || !safeText(current.menuText)
          ? (vendor.defaultMenuText || '')
          : current.menuText,
        priceText: overwrite || !safeText(current.priceText)
          ? (vendor.defaultPriceText || '')
          : current.priceText,
        notice: overwrite || !safeText(current.notice)
          ? (vendor.defaultNotice || '')
          : current.notice,
        address: overwrite || !currentLocation
          ? (vendor.commonAddress || '')
          : current.address,
        location: overwrite || !currentLocation
          ? commonLocation
          : currentLocation,
        date: current.date,
        startTime: current.startTime,
        endTime: current.endTime,
        preciseDuringEvent: current.preciseDuringEvent
      }
    }, () => this.scheduleDraftSave())
  },

  reapplyVendorDefaults() {
    if (!this.data.vendor) {
      this.editVendor()
      return
    }

    wx.showModal({
      title: '重新带入常用资料',
      content: '会覆盖当前填写的名称、介绍、分类、菜单、价格、公告和常用地点。',
      confirmText: '重新带入',
      success: res => {
        if (!res.confirm) return
        this.applyVendorDefaults(this.data.vendor, true)
        wx.showToast({ title: '已自动带入', icon: 'success' })
      }
    })
  },

  editVendor() {
    this.persistDraftNow()
    this.shouldRefreshVendor = true
    wx.navigateTo({ url: '/pages/vendor-edit/index' })
  },

  input(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: e.detail.value }, () => this.scheduleDraftSave())
  },

  inputCustomCategory(e) {
    this.setData({ customCategory: e.detail.value }, () => this.scheduleDraftSave())
  },

  chooseCategory(e) {
    const categoryIndex = Number(e.currentTarget.dataset.index)
    const selected = CATEGORY_OPTIONS[categoryIndex]
    if (!selected) return

    this.setData({
      categoryIndex,
      customMode: selected.value === '自定义',
      currentCategoryIcon: selected.icon
    }, () => this.scheduleDraftSave())
  },

  chooseDate(e) {
    this.setData({ 'form.date': e.detail.value }, () => this.scheduleDraftSave())
  },

  chooseStart(e) {
    this.setData({ 'form.startTime': e.detail.value }, () => this.scheduleDraftSave())
  },

  chooseEnd(e) {
    this.setData({ 'form.endTime': e.detail.value }, () => this.scheduleDraftSave())
  },

  togglePrecise(e) {
    this.setData({ 'form.preciseDuringEvent': e.detail.value }, () => this.scheduleDraftSave())
  },

  choosePlace() {
    if (this.choosingPlace) return
    this.choosingPlace = true
    this.persistDraftNow()

    privacy.chooseLocation().then(res => {
      const location = normalizeLocation(res)
      if (!location) throw new Error('地图没有返回有效坐标，请重新选择')

      const address = safeText(res.name) || safeText(res.address) || '已选择位置'
      this.setData({
        'form.address': address.slice(0, 120),
        'form.location': location
      }, () => {
        this.persistDraftNow()
        wx.showToast({ title: '地点已选择', icon: 'success' })
      })
    }).catch(err => {
      const message = String(err && (err.message || err.errMsg) || '')
      const cancelled = /cancel/i.test(message)
      if (!cancelled) {
        wx.showToast({ title: message || '地点选择失败，请重试', icon: 'none' })
      }
    }).finally(() => {
      this.choosingPlace = false
    })
  },

  chooseImages() {
    const remain = 6 - this.data.images.length
    if (remain <= 0) return

    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: res => {
        const next = this.data.images.concat(res.tempFiles.map(item => item.tempFilePath))
        this.setData({ images: next.slice(0, 6) })
      }
    })
  },

  removeImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = this.data.images.slice()
    images.splice(index, 1)
    this.setData({ images })
  },

  previewImage(e) {
    wx.previewImage({
      current: e.currentTarget.dataset.url,
      urls: this.data.images
    })
  },

  getFinalCategory() {
    const selected = CATEGORY_OPTIONS[this.data.categoryIndex] || CATEGORY_OPTIONS[0]
    return this.data.customMode
      ? safeText(this.data.customCategory)
      : selected.value
  },

  validate() {
    const form = this.data.form
    const location = normalizeLocation(form.location)

    if (!this.data.vendor) return '请先完善摊主资料'
    if (!safeText(form.name)) return '请填写摊位或本场名称'
    if (!this.getFinalCategory()) return '请填写自定义品类'
    if (!safeText(form.description)) return '请简单介绍本场内容'
    if (!location || !safeText(form.address)) return '请选择出摊地点'

    const startAt = dateUtil.buildTimestamp(form.date, form.startTime)
    let endAt = dateUtil.buildTimestamp(form.date, form.endTime)
    if (endAt <= startAt) endAt += 24 * 60 * 60 * 1000
    if (startAt < Date.now() - 10 * 60 * 1000) return '出摊开始时间不能早于现在'
    if (endAt - startAt > 24 * 60 * 60 * 1000) return '单场出摊时长请控制在 24 小时内'

    return { startAt, endAt, location }
  },

  submit() {
    // setData 更新并不是同步的，因此额外使用实例锁，彻底拦截连续快速点击。
    if (this.submitLock || this.data.submitting || this.data.publishSucceeded) return

    const checked = this.validate()
    if (typeof checked === 'string') {
      wx.showToast({ title: checked, icon: 'none' })
      if (!this.data.vendor) this.editVendor()
      return
    }

    this.submitLock = true
    const form = Object.assign({}, this.data.form)
    const category = this.getFinalCategory()
    const imagePaths = this.data.images.slice()
    const clientRequestId = this.publishRequestId ||
      `publish_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    this.publishRequestId = clientRequestId

    this.persistDraftNow()
    this.setData({ submitting: true, publishSucceeded: false })
    wx.showLoading({ title: '正在发布', mask: true })

    api.uploadFiles(imagePaths, 'stalls').then(images => {
      return api.call('createStall', {
        clientRequestId,
        name: safeText(form.name),
        category,
        description: safeText(form.description),
        menuText: safeText(form.menuText),
        priceText: safeText(form.priceText) || '价格以现场为准',
        notice: safeText(form.notice),
        address: safeText(form.address),
        location: checked.location,
        latitude: checked.location.latitude,
        longitude: checked.location.longitude,
        startAt: checked.startAt,
        endAt: checked.endAt,
        preciseDuringEvent: Boolean(form.preciseDuringEvent),
        images,
        emoji: '',
        theme: this.data.categoryIndex % 2 ? 'mint' : 'coral'
      })
    }).then(res => {
      wx.hideLoading()
      this.setData({
        submitting: false,
        publishSucceeded: true
      })

      const pending = res && res.auditStatus === 'pending'
      const duplicate = Boolean(res && res.duplicate)

      wx.showToast({
        title: duplicate ? '这场已经发布' : '出摊发布成功',
        icon: 'success',
        duration: 1800
      })

      let handled = false
      const finish = () => {
        if (handled) return
        handled = true
        this.resetFormAfterSuccess()
        this.submitLock = false
        this.publishRequestId = ''
        this.setData({ publishSucceeded: false })

        if (pending) {
          wx.navigateTo({ url: '/pages/my-stalls/index' })
        } else {
          wx.switchTab({ url: '/pages/home/index' })
        }
      }

      wx.showModal({
        title: duplicate
          ? '这场出摊已发布'
          : pending
            ? '已提交审核'
            : '发布成功',
        content: duplicate
          ? '系统已拦截重复提交，首页只会保留一条出摊信息。点击下方按钮前往首页查看。'
          : pending
            ? '内容正在审核，你可以在“我的出摊”查看处理状态。'
            : '出摊信息已经同步到首页和地图，系统会自动防止重复发布。',
        showCancel: false,
        confirmText: pending ? '查看状态' : '去首页查看',
        success: finish,
        fail: finish
      })
    }).catch(err => {
      wx.hideLoading()
      this.persistDraftNow()
      this.submitLock = false
      this.setData({ submitting: false, publishSucceeded: false })

      const rawMessage = String(err && (err.message || err.errMsg) || '')
      const message = rawMessage.includes('location') || rawMessage.includes('地点')
        ? '地点信息提交失败，请重新选择地点后再试。'
        : rawMessage || '服务暂时不可用，请稍后重试。'

      wx.showModal({
        title: '发布失败',
        content: `${message}\n\n当前填写的内容和已选地点已保留，不会被重置。`,
        showCancel: false,
        confirmText: '知道了'
      })
    })
  },

  resetFormAfterSuccess() {
    wx.removeStorageSync(DRAFT_KEY)
    this.publishRequestId = ''
    this.setData({
      images: [],
      publishSucceeded: false,
      hasPrefilled: false,
      form: blankForm()
    }, () => {
      if (this.data.vendor) {
        this.applyVendorDefaults(this.data.vendor, true)
      }
    })
  },

  scheduleDraftSave() {
    clearTimeout(this.draftTimer)
    this.draftTimer = setTimeout(() => this.persistDraftNow(), 250)
  },

  persistDraftNow() {
    clearTimeout(this.draftTimer)

    const location = normalizeLocation(this.data.form.location)
    const draft = {
      savedAt: Date.now(),
      clientRequestId: this.publishRequestId || '',
      categoryIndex: this.data.categoryIndex,
      customMode: this.data.customMode,
      customCategory: this.data.customCategory,
      currentCategoryIcon: this.data.currentCategoryIcon,
      hasPrefilled: true,
      form: Object.assign({}, this.data.form, { location })
    }

    try {
      wx.setStorageSync(DRAFT_KEY, draft)
    } catch (err) {
      console.warn('[publish] save draft failed', err)
    }
  },

  readDraft() {
    try {
      const draft = wx.getStorageSync(DRAFT_KEY)
      if (!draft || !draft.savedAt || Date.now() - Number(draft.savedAt) > DRAFT_MAX_AGE) {
        wx.removeStorageSync(DRAFT_KEY)
        return null
      }

      const categoryIndex = Number(draft.categoryIndex)
      const safeIndex = CATEGORY_OPTIONS[categoryIndex] ? categoryIndex : 0
      const form = Object.assign(blankForm(), draft.form || {}, {
        location: normalizeLocation(draft.form && draft.form.location)
      })
      this.publishRequestId = safeText(draft.clientRequestId)

      return {
        categoryIndex: safeIndex,
        customMode: Boolean(draft.customMode),
        customCategory: safeText(draft.customCategory),
        currentCategoryIcon: CATEGORY_OPTIONS[safeIndex].icon,
        hasPrefilled: true,
        form
      }
    } catch (err) {
      console.warn('[publish] read draft failed', err)
      return null
    }
  }
})

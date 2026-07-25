const config = require('../config')
const store = require('./store')
const { decorate } = require('../data/stall')

const LOCAL_OPENID = 'local-preview-user'

const KEYS = {
  stalls: 'ctgl_stalls_v1',
  favorites: 'ctgl_favorite_vendors_v2',
  legacyFavorites: 'ctgl_favorites_v1',
  vendor: 'ctgl_vendor_v1',
  profile: 'ctgl_profile_v1',
  reports: 'ctgl_reports_v1',
  subscriptions: 'ctgl_subscriptions_v2',
  admins: 'ctgl_admins_v1',
  migration: 'ctgl_clean_data_v5'
}

const READ_GROUPS = {
  listStalls: 'stalls',
  favoriteList: 'favorites',
  favoriteDueAlerts: 'favoriteAlerts',
  me: 'me',
  myStalls: 'myStalls',
  getStall: 'detail',
  adminList: 'admin'
}

const inFlight = Object.create(null)

const WRITE_INVALIDATION = {
  saveProfile: ['me'],
  saveVendor: ['me', 'vendor'],
  createStall: ['stalls', 'myStalls', 'me', 'favorites'],
  updateStall: ['stalls', 'myStalls', 'favorites'],
  setStallStatus: ['stalls', 'myStalls', 'favorites'],
  deleteStall: ['stalls', 'myStalls', 'favorites', 'me'],
  toggleFavorite: ['stalls', 'favorites', 'me'],
  subscribeVendor: ['favorites'],
  report: ['admin'],
  adminAuditStall: ['stalls', 'myStalls', 'admin'],
  adminHandleReport: ['admin'],
  adminAdd: ['admin', 'me'],
  adminRemove: ['admin', 'me'],
  cleanupLegacyDemo: ['stalls', 'myStalls', 'admin']
}

function getStoredArray(key) {
  const value = wx.getStorageSync(key)
  return Array.isArray(value) ? value : []
}

function normalizeLocation(location, latitude, longitude) {
  const source = location || {}
  const rawLat = source.latitude !== undefined ? source.latitude : latitude
  const rawLng = source.longitude !== undefined ? source.longitude : longitude
  if (rawLat === null || rawLat === undefined || rawLat === '' ||
      rawLng === null || rawLng === undefined || rawLng === '') return null

  const lat = Number(rawLat)
  const lng = Number(rawLng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { latitude: lat, longitude: lng }
}

function normalizedIdentityText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function coordinateIdentity(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(5) : ''
}

function buildPublishKey(stall = {}) {
  const location = normalizeLocation(stall.location, stall.latitude, stall.longitude) || {}
  return [
    normalizedIdentityText(stall.ownerOpenid || LOCAL_OPENID),
    normalizedIdentityText(stall.name),
    normalizedIdentityText(stall.category),
    normalizedIdentityText(stall.address),
    coordinateIdentity(location.latitude),
    coordinateIdentity(location.longitude),
    String(Number(stall.startAt) || 0),
    String(Number(stall.endAt) || 0)
  ].join('|')
}

function dedupeStoredStalls(records = []) {
  const unique = new Map()
  records.forEach(item => {
    const key = item.publishKey || buildPublishKey(item)
    const existing = unique.get(key)
    if (!existing || Number(item.createdAt || 0) > Number(existing.createdAt || 0)) {
      unique.set(key, Object.assign({}, item, { publishKey: key }))
    }
  })
  return Array.from(unique.values())
}

function chooseFavoriteStalls(records, vendorIds) {
  const now = Date.now()
  const chosen = new Map()
  records
    .filter(item => vendorIds.includes(item.ownerOpenid))
    .filter(item => item.status !== 'deleted' && item.auditStatus === 'approved')
    .sort((a, b) => {
      const score = item => item.status === 'active' && now >= item.startAt && now <= item.endAt
        ? 0
        : item.startAt > now ? 1 : 2
      const diff = score(a) - score(b)
      if (diff) return diff
      if (score(a) === 1) return a.startAt - b.startAt
      return b.startAt - a.startAt
    })
    .forEach(item => {
      if (!chosen.has(item.ownerOpenid)) chosen.set(item.ownerOpenid, item)
    })
  return Array.from(chosen.values())
}

function ensureLocalData() {
  ;[KEYS.stalls, KEYS.favorites, KEYS.reports, KEYS.subscriptions, KEYS.admins].forEach(key => {
    if (!Array.isArray(wx.getStorageSync(key))) wx.setStorageSync(key, [])
  })

  if (!wx.getStorageSync(KEYS.migration)) {
    const stalls = dedupeStoredStalls(getStoredArray(KEYS.stalls)
      .filter(item => {
        const id = String(item && item._id || '')
        return !id.startsWith('demo_') && !id.startsWith('review_demo_')
      })
      .map(item => item.ownerOpenid === 'local-demo-openid'
        ? Object.assign({}, item, { ownerOpenid: LOCAL_OPENID })
        : item))
    wx.setStorageSync(KEYS.stalls, stalls)

    const legacy = getStoredArray(KEYS.legacyFavorites)
    const vendorIds = Array.from(new Set(legacy.map(id => {
      const stall = stalls.find(item => item._id === id)
      return stall && stall.ownerOpenid
    }).filter(Boolean)))
    if (!getStoredArray(KEYS.favorites).length && vendorIds.length) {
      wx.setStorageSync(KEYS.favorites, vendorIds)
    }
    wx.setStorageSync(KEYS.migration, true)
  }

  const admins = getStoredArray(KEYS.admins)
  if (!admins.length) {
    wx.setStorageSync(KEYS.admins, [{
      openid: LOCAL_OPENID,
      role: 'super_admin',
      name: '本地预览超级管理员',
      enabled: true,
      createdAt: Date.now()
    }])
  }
}

function localCall(action, data = {}) {
  ensureLocalData()
  const stalls = getStoredArray(KEYS.stalls)
  const favorites = getStoredArray(KEYS.favorites)
  const vendor = wx.getStorageSync(KEYS.vendor) || null
  const profile = wx.getStorageSync(KEYS.profile) || { nickname: '微信用户', avatarUrl: '' }
  const admins = getStoredArray(KEYS.admins)

  switch (action) {
    case 'me':
      return Promise.resolve({
        openid: LOCAL_OPENID,
        profile,
        vendor,
        isAdmin: true,
        isSuperAdmin: true,
        adminRole: 'super_admin',
        cloudIdentity: false,
        stats: {
          stalls: stalls.filter(item => item.ownerOpenid === LOCAL_OPENID && item.status !== 'deleted').length,
          favorites: favorites.length
        }
      })

    case 'listStalls': {
      const keyword = String(data.keyword || '').trim().toLowerCase()
      const category = data.category || ''
      let items = dedupeStoredStalls(stalls)
        .filter(item => item.auditStatus === 'approved' && item.status !== 'deleted')
        .map(item => decorate(item, data.latitude, data.longitude, favorites))
        .filter(item => !category || category === '全部' || item.category === category)
        .filter(item => !keyword || [item.name, item.vendorName, item.category, item.address, item.menuText, item.description]
          .join(' ').toLowerCase().includes(keyword))
        .filter(item => !data.openNow || item.isOpen)
      if (data.maxDistance && Number(data.latitude) && Number(data.longitude)) {
        items = items.filter(item => item.distanceKm === null || item.distanceKm <= Number(data.maxDistance))
      }
      items.sort((a, b) => {
        if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1
        if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm
        return a.startAt - b.startAt
      })
      return Promise.resolve({ items })
    }

    case 'getStall': {
      const stall = stalls.find(item => item._id === data.id && item.status !== 'deleted')
      if (!stall) return Promise.reject(new Error('没有找到这条出摊信息'))
      return Promise.resolve({ item: decorate(stall, data.latitude, data.longitude, favorites) })
    }

    case 'saveProfile': {
      const next = {
        nickname: String(data.nickname || '微信用户').trim().slice(0, 20),
        avatarUrl: data.avatarUrl || ''
      }
      wx.setStorageSync(KEYS.profile, next)
      return Promise.resolve(next)
    }

    case 'saveVendor': {
      const next = {
        name: String(data.name || '').trim().slice(0, 30),
        intro: String(data.intro || '').trim().slice(0, 200),
        avatarUrl: data.avatarUrl || '',
        defaultStallName: String(data.defaultStallName || '').trim().slice(0, 30),
        defaultCategory: String(data.defaultCategory || '').trim().slice(0, 30),
        defaultDescription: String(data.defaultDescription || '').trim().slice(0, 300),
        defaultMenuText: String(data.defaultMenuText || '').trim().slice(0, 100),
        defaultPriceText: String(data.defaultPriceText || '').trim().slice(0, 50),
        defaultNotice: String(data.defaultNotice || '').trim().slice(0, 120),
        commonAddress: String(data.commonAddress || '').trim().slice(0, 120),
        commonLocation: normalizeLocation(data.commonLocation),
        verified: false,
        updatedAt: Date.now()
      }
      wx.setStorageSync(KEYS.vendor, next)
      return Promise.resolve(next)
    }

    case 'createStall': {
      if (!vendor) return Promise.reject(new Error('请先完善摊主资料'))
      const location = normalizeLocation(data.location, data.latitude, data.longitude)
      const address = String(data.address || '').trim().slice(0, 120)
      if (!location || !address) return Promise.reject(new Error('请选择有效的出摊地点'))
      const publishKey = buildPublishKey(Object.assign({}, data, { ownerOpenid: LOCAL_OPENID, address, location }))
      const existing = stalls.filter(item => item.status !== 'deleted')
        .find(item => (item.publishKey || buildPublishKey(item)) === publishKey)
      if (existing) return Promise.resolve({ id: existing._id, auditStatus: existing.auditStatus || 'approved', duplicate: true })

      const next = Object.assign({}, data, {
        address,
        location,
        publishKey,
        _id: `stall_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ownerOpenid: LOCAL_OPENID,
        vendorName: vendor.name,
        vendorAvatar: vendor.avatarUrl || '',
        auditStatus: 'approved',
        status: 'active',
        favoriteCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      delete next.latitude
      delete next.longitude
      stalls.unshift(next)
      wx.setStorageSync(KEYS.stalls, dedupeStoredStalls(stalls))
      return Promise.resolve({ id: next._id, auditStatus: 'approved', duplicate: false })
    }

    case 'updateStall': {
      const index = stalls.findIndex(item => item._id === data.id)
      if (index < 0) return Promise.reject(new Error('摊位不存在'))
      stalls[index] = Object.assign({}, stalls[index], data.patch, { updatedAt: Date.now(), auditStatus: 'approved' })
      wx.setStorageSync(KEYS.stalls, stalls)
      return Promise.resolve({ id: data.id, auditStatus: 'approved' })
    }

    case 'myStalls': {
      const items = dedupeStoredStalls(stalls)
        .filter(item => item.ownerOpenid === LOCAL_OPENID && item.status !== 'deleted')
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .map(item => decorate(item, null, null, favorites))
      return Promise.resolve({ items })
    }

    case 'setStallStatus': {
      const index = stalls.findIndex(item => item._id === data.id)
      if (index < 0) return Promise.reject(new Error('摊位不存在'))
      stalls[index].status = data.status
      stalls[index].updatedAt = Date.now()
      wx.setStorageSync(KEYS.stalls, stalls)
      return Promise.resolve({ ok: true })
    }

    case 'deleteStall': {
      const index = stalls.findIndex(item => item._id === data.id)
      if (index >= 0) {
        stalls[index].status = 'deleted'
        stalls[index].updatedAt = Date.now()
      }
      wx.setStorageSync(KEYS.stalls, stalls)
      return Promise.resolve({ ok: true })
    }

    case 'toggleFavorite': {
      const stall = stalls.find(item => item._id === data.id)
      if (!stall) return Promise.reject(new Error('摊位不存在'))
      const vendorOpenid = stall.ownerOpenid
      const index = favorites.indexOf(vendorOpenid)
      const active = index < 0
      if (active) favorites.push(vendorOpenid)
      else favorites.splice(index, 1)
      wx.setStorageSync(KEYS.favorites, favorites)
      return Promise.resolve({ active, vendorOpenid, vendorName: stall.vendorName || '摊主' })
    }

    case 'favoriteList': {
      const items = chooseFavoriteStalls(dedupeStoredStalls(stalls), favorites)
        .map(item => decorate(item, data.latitude, data.longitude, favorites))
      return Promise.resolve({ items })
    }

    case 'favoriteDueAlerts': {
      const now = Date.now()
      const items = dedupeStoredStalls(stalls)
        .filter(item => favorites.includes(item.ownerOpenid))
        .filter(item => item.auditStatus === 'approved' && item.status === 'active')
        .filter(item => item.startAt <= now && item.endAt >= now)
        .map(item => ({
          _id: item._id,
          name: item.name,
          vendorName: item.vendorName,
          address: item.address,
          startAt: item.startAt,
          timeText: decorate(item, null, null, favorites).timeText
        }))
      return Promise.resolve({ items })
    }

    case 'subscribeVendor': {
      const list = getStoredArray(KEYS.subscriptions)
      const vendorOpenid = String(data.vendorOpenid || '')
      const nextStall = stalls
        .filter(item => item.ownerOpenid === vendorOpenid && item.status === 'active' && item.auditStatus === 'approved')
        .filter(item => item.endAt > Date.now())
        .sort((a, b) => a.startAt - b.startAt)[0]
      const index = list.findIndex(item => item.ownerOpenid === LOCAL_OPENID && item.vendorOpenid === vendorOpenid)
      const record = {
        ownerOpenid: LOCAL_OPENID,
        vendorOpenid,
        stallId: nextStall ? nextStall._id : '',
        sendAt: nextStall ? nextStall.startAt : 0,
        status: nextStall ? 'pending' : 'waiting',
        createdAt: Date.now()
      }
      if (index >= 0) list[index] = record
      else list.push(record)
      wx.setStorageSync(KEYS.subscriptions, list)
      return Promise.resolve({ ok: true, scheduled: Boolean(nextStall) })
    }

    case 'report': {
      const reports = getStoredArray(KEYS.reports)
      reports.unshift({
        _id: `report_${Date.now()}`,
        stallId: data.stallId,
        reason: data.reason,
        detail: data.detail || '',
        status: 'pending',
        createdAt: Date.now()
      })
      wx.setStorageSync(KEYS.reports, reports)
      return Promise.resolve({ ok: true })
    }

    case 'adminList': {
      const reports = getStoredArray(KEYS.reports)
      const pending = stalls.filter(item => item.auditStatus === 'pending')
        .map(item => decorate(item, null, null, favorites))
      return Promise.resolve({ pending, reports, admins, isSuperAdmin: true })
    }

    case 'adminAdd': {
      const target = String(data.openid || '').trim()
      if (!target) return Promise.reject(new Error('请输入用户身份编号'))
      if (!admins.find(item => item.openid === target)) {
        admins.push({ openid: target, role: 'admin', name: String(data.name || '运营管理员'), enabled: true, createdAt: Date.now() })
        wx.setStorageSync(KEYS.admins, admins)
      }
      return Promise.resolve({ ok: true })
    }

    case 'adminRemove': {
      const target = String(data.openid || '').trim()
      const next = admins.filter(item => item.openid !== target || item.role === 'super_admin')
      wx.setStorageSync(KEYS.admins, next)
      return Promise.resolve({ ok: true })
    }

    case 'adminAuditStall': {
      const index = stalls.findIndex(item => item._id === data.id)
      if (index >= 0) {
        stalls[index].auditStatus = data.result
        stalls[index].auditRemark = data.remark || ''
        wx.setStorageSync(KEYS.stalls, stalls)
      }
      return Promise.resolve({ ok: true })
    }

    case 'adminHandleReport': {
      const reports = getStoredArray(KEYS.reports)
      const index = reports.findIndex(item => item._id === data.id)
      if (index >= 0) {
        reports[index].status = data.status
        wx.setStorageSync(KEYS.reports, reports)
      }
      return Promise.resolve({ ok: true })
    }

    case 'cleanupLegacyDemo': {
      const cleaned = stalls.filter(item => {
        const id = String(item && item._id || '')
        return !id.startsWith('demo_') && !id.startsWith('review_demo_')
      })
      wx.setStorageSync(KEYS.stalls, cleaned)
      return Promise.resolve({ removed: stalls.length - cleaned.length })
    }

    default:
      return Promise.reject(new Error(`未知操作：${action}`))
  }
}

function cloudCall(action, data = {}) {
  return wx.cloud.callFunction({
    name: 'api',
    data: { action, data }
  }).then(res => {
    const result = res.result || {}
    if (!result.ok) throw new Error(result.message || '服务暂时不可用')
    return result.data
  })
}

function rawCall(action, data = {}) {
  if (!config.USE_CLOUD || !wx.cloud) return localCall(action, data)
  return cloudCall(action, data).catch(err => {
    console.error('[cloud api]', action, err)
    if (config.ALLOW_DEMO_FALLBACK) {
      wx.showToast({ title: '云端暂不可用，已切换本地数据', icon: 'none' })
      return localCall(action, data)
    }
    throw err
  })
}

function call(action, data = {}, options = {}) {
  const readGroup = READ_GROUPS[action]
  const force = Boolean(options.force)
  const requestKey = `${action}:${JSON.stringify(data)}`

  if (!force && readGroup) {
    const cached = store.get(action, data)
    if (cached !== null) {
      store.markClean(readGroup)
      return Promise.resolve(cached)
    }
    if (inFlight[requestKey]) return inFlight[requestKey]
  }

  const request = rawCall(action, data).then(result => {
    if (readGroup) {
      store.set(action, data, result)
      store.markClean(readGroup)
    }
    const groups = WRITE_INVALIDATION[action]
    if (groups) store.invalidate(groups)
    return result
  })

  if (!force && readGroup) {
    inFlight[requestKey] = request.finally(() => { delete inFlight[requestKey] })
    return inFlight[requestKey]
  }
  return request
}

function uploadFiles(paths, folder = 'stall') {
  if (!paths || paths.length === 0) return Promise.resolve([])
  if (!config.USE_CLOUD || !wx.cloud) return Promise.resolve(paths)

  const tasks = paths.map((filePath, index) => {
    if (String(filePath).startsWith('cloud://')) return Promise.resolve(filePath)
    const extMatch = String(filePath).match(/\.([a-zA-Z0-9]+)(?:\?|$)/)
    const ext = extMatch ? extMatch[1] : 'jpg'
    const cloudPath = `${folder}/${Date.now()}_${index}_${Math.random().toString(36).slice(2)}.${ext}`
    return wx.cloud.uploadFile({ cloudPath, filePath }).then(res => res.fileID)
  })
  return Promise.all(tasks)
}

module.exports = { call, uploadFiles }

const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

function cleanText(value, max = 300) {
  return String(value || '').trim().slice(0, max)
}

const CATEGORY_ICON_MAP = {
  '饭团便当': '/assets/icons/category-rice.png',
  '早餐早点': '/assets/icons/category-breakfast.png',
  '面点小吃': '/assets/icons/category-dumpling.png',
  '粉面汤粥': '/assets/icons/category-noodles.png',
  '烧烤炸物': '/assets/icons/category-skewer.png',
  '熟食卤味': '/assets/icons/category-braised.png',
  '甜品烘焙': '/assets/icons/category-bakery.png',
  '冰粉糖水': '/assets/icons/category-dessert.png',
  '咖啡茶饮': '/assets/icons/category-drink.png',
  '水果鲜食': '/assets/icons/category-fruit.png',
  '地方特色': '/assets/icons/category-specialty.png',
  '手作零食': '/assets/icons/category-snack.png',
  '夜宵小炒': '/assets/icons/category-supper.png',
  '农产品': '/assets/icons/category-farm.png',
  '其他': '/assets/icons/store.png'
}

function categoryIconPath(category) {
  return CATEGORY_ICON_MAP[category] || '/assets/icons/category-custom.png'
}

function isLegacyDemo(item) {
  const id = String(item && item._id || '')
  return id.startsWith('demo_') || id.startsWith('review_demo_')
}

function optionalCoordinate(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
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
  return cleanText(value, 160).replace(/\s+/g, ' ').toLowerCase()
}

function coordinateIdentity(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(5) : ''
}

function buildPublishKey(stall = {}) {
  const location = normalizeLocation(stall.location, stall.latitude, stall.longitude) || {}
  const canonical = [
    normalizedIdentityText(stall.ownerOpenid),
    normalizedIdentityText(stall.name),
    normalizedIdentityText(stall.category),
    normalizedIdentityText(stall.address),
    coordinateIdentity(location.latitude),
    coordinateIdentity(location.longitude),
    String(Number(stall.startAt) || 0),
    String(Number(stall.endAt) || 0)
  ].join('|')

  return crypto.createHash('sha256').update(canonical).digest('hex')
}

function dedupeStallRecords(records = []) {
  const unique = new Map()

  records.forEach(item => {
    const key = item.publishKey || buildPublishKey(item)
    const existing = unique.get(key)
    if (!existing || Number(item.createdAt || 0) > Number(existing.createdAt || 0)) {
      unique.set(key, item)
    }
  })

  return Array.from(unique.values())
}

async function findExistingPublish(openid, publishKey) {
  const result = await db.collection('stalls')
    .where({ ownerOpenid: openid })
    .limit(100)
    .get()

  return result.data
    .filter(item => item.status !== 'deleted')
    .filter(item => (item.publishKey || buildPublishKey(item)) === publishKey)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0] || null
}

function toRad(value) {
  return value * Math.PI / 180
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const values = [lat1, lng1, lat2, lng2].map(Number)
  if (values.some(value => !Number.isFinite(value))) return null
  const [aLat, aLng, bLat, bLng] = values
  const radius = 6371
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) *
    Math.sin(dLng / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(km) {
  if (km === null || km === undefined) return '距离未知'
  if (km < 1) return `${Math.max(10, Math.round(km * 1000 / 10) * 10)}m`
  return `${km.toFixed(km < 10 ? 1 : 0)}km`
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatDate(timestamp) {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatTime(timestamp) {
  const d = new Date(timestamp)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDateTime(timestamp) {
  const d = new Date(timestamp)
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return `${sameDay ? '今天' : `${d.getMonth() + 1}月${d.getDate()}日`} ${formatTime(timestamp)}`
}

function formatRange(startAt, endAt) {
  if (!startAt || !endAt) return '时间待定'
  if (formatDate(startAt) === formatDate(endAt)) {
    return `${formatDateTime(startAt)} - ${formatTime(endAt)}`
  }
  return `${formatDateTime(startAt)} - ${formatDateTime(endAt)}`
}

function decorateStall(stall, favoriteVendorIds, latitude, longitude) {
  const now = Date.now()
  const item = Object.assign({}, stall)
  item.isOpen = item.status === 'active' && now >= item.startAt && now <= item.endAt
  item.statusText = item.status === 'cancelled'
    ? '已取消'
    : item.isOpen
      ? '正在出摊'
      : now < item.startAt
        ? '即将出摊'
        : '本场已结束'
  item.timeText = formatRange(item.startAt, item.endAt)
  const hasViewerLocation =
    latitude !== null &&
    latitude !== undefined &&
    longitude !== null &&
    longitude !== undefined &&
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude))

  item.distanceKm = hasViewerLocation
    ? distanceKm(
        latitude,
        longitude,
        item.location && item.location.latitude,
        item.location && item.location.longitude
      )
    : null
  item.distanceText = formatDistance(item.distanceKm)
  item.vendorId = item.ownerOpenid || ''
  item.isFavorite = favoriteVendorIds.includes(item.vendorId)
  item.categoryIcon = categoryIconPath(item.category)

  delete item.ownerOpenid
  return item
}

async function getAdminRecord(openid) {
  try {
    const result = await db.collection('admins').doc(openid).get()
    const record = result.data || {}
    if (record.enabled === false) return null
    return Object.assign({ openid }, record)
  } catch (err) {
    return null
  }
}

async function ensureFirstSuperAdmin(openid) {
  const current = await getAdminRecord(openid)
  const result = await db.collection('admins').limit(100).get()
  const active = result.data.filter(item => item.enabled !== false)
  const superAdmin = active.find(item => item.role === 'super_admin')
  if (superAdmin) return current

  if (current) {
    await db.collection('admins').doc(openid).update({
      data: {
        role: 'super_admin',
        name: current.name || '超级管理员',
        promotedAt: Date.now(),
        updatedAt: Date.now()
      }
    })
    return Object.assign({}, current, { role: 'super_admin' })
  }

  if (active.length === 0) {
    const record = {
      role: 'super_admin',
      name: '超级管理员',
      enabled: true,
      createdBy: 'first_user_bootstrap',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    await db.collection('admins').doc(openid).set({ data: record })
    return Object.assign({ openid }, record)
  }

  const oldest = active
    .slice()
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))[0]
  await db.collection('admins').doc(oldest._id).update({
    data: {
      role: 'super_admin',
      name: oldest.name || '超级管理员',
      promotedAt: Date.now(),
      updatedAt: Date.now()
    }
  })

  return null
}

async function isAdmin(openid) {
  return Boolean(await getAdminRecord(openid))
}

async function isSuperAdmin(openid) {
  const record = await getAdminRecord(openid)
  return Boolean(record && record.role === 'super_admin')
}

async function getVendor(openid) {
  try {
    const result = await db.collection('vendors').doc(openid).get()
    return result.data
  } catch (err) {
    return null
  }
}

async function getFavoriteRecords(openid) {
  const result = await db.collection('favorites')
    .where({ ownerOpenid: openid })
    .limit(100)
    .get()

  const migrated = await Promise.all(result.data.map(async item => {
    if (item.vendorOpenid) return item
    if (!item.stallId) return item

    try {
      const stall = await getStallRaw(item.stallId)
      if (!stall || !stall.ownerOpenid) return item
      await db.collection('favorites').doc(item._id).update({
        data: {
          vendorOpenid: stall.ownerOpenid,
          migratedAt: Date.now()
        }
      })
      return Object.assign({}, item, { vendorOpenid: stall.ownerOpenid })
    } catch (err) {
      return item
    }
  }))

  return migrated
}

async function getFavoriteVendorIds(openid) {
  const records = await getFavoriteRecords(openid)
  return Array.from(new Set(records.map(item => item.vendorOpenid).filter(Boolean)))
}

async function ensureUser(openid) {
  const now = Date.now()
  try {
    const result = await db.collection('users').doc(openid).get()
    await db.collection('users').doc(openid).update({
      data: { lastSeenAt: now }
    })
    return result.data
  } catch (err) {
    const user = {
      nickname: '微信用户',
      avatarUrl: '',
      createdAt: now,
      lastSeenAt: now
    }
    await db.collection('users').doc(openid).set({ data: user })
    return user
  }
}

async function checkText(openid, content) {
  const text = cleanText(content, 2000)
  if (!text) return true

  try {
    const result = await cloud.openapi.security.msgSecCheck({
      openid,
      scene: 2,
      version: 2,
      content: text
    })
    return result && result.result && result.result.suggest === 'pass'
  } catch (err) {
    console.warn('msgSecCheck unavailable; publish continues with security status recorded', err)
    return null
  }
}

async function getStallRaw(id) {
  const result = await db.collection('stalls').doc(id).get()
  return result.data
}

async function me(openid) {
  await ensureUser(openid)
  await ensureFirstSuperAdmin(openid)

  const [profile, vendor, adminRecord, stallCount, favoriteVendorIds] = await Promise.all([
    ensureUser(openid),
    getVendor(openid),
    getAdminRecord(openid),
    db.collection('stalls').where({ ownerOpenid: openid }).count(),
    getFavoriteVendorIds(openid)
  ])

  return {
    openid,
    profile,
    vendor,
    isAdmin: Boolean(adminRecord),
    isSuperAdmin: Boolean(adminRecord && adminRecord.role === 'super_admin'),
    adminRole: adminRecord ? adminRecord.role : '',
    cloudIdentity: true,
    stats: {
      stalls: stallCount.total,
      favorites: favoriteVendorIds.length
    }
  }
}

async function listStalls(openid, data) {
  const [result, favoriteIds] = await Promise.all([
    db.collection('stalls')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get(),
    getFavoriteVendorIds(openid)
  ])

  const now = Date.now()
  const keyword = cleanText(data.keyword, 50).toLowerCase()
  const category = cleanText(data.category, 20)
  const latitude = optionalCoordinate(data.latitude)
  const longitude = optionalCoordinate(data.longitude)
  const maxDistance = Number(data.maxDistance)

  const visibleRecords = result.data
    .filter(item => !isLegacyDemo(item))
    .filter(item => item.auditStatus === 'approved')
    .filter(item => item.status !== 'deleted')
    .filter(item => item.endAt >= now - 8 * 60 * 60 * 1000)
    .filter(item => item.startAt <= now + 45 * 24 * 60 * 60 * 1000)

  let items = dedupeStallRecords(visibleRecords)
    .map(item => decorateStall(item, favoriteIds, latitude, longitude))
    .filter(item => !category || category === '全部' || item.category === category)
    .filter(item => !keyword || [
      item.name,
      item.vendorName,
      item.category,
      item.address,
      item.menuText,
      item.description
    ].join(' ').toLowerCase().includes(keyword))
    .filter(item => !data.openNow || item.isOpen)

  if (Number.isFinite(maxDistance) && maxDistance > 0 && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    items = items.filter(item => item.distanceKm === null || item.distanceKm <= maxDistance)
  }

  items.sort((a, b) => {
    if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1
    if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm
    return a.startAt - b.startAt
  })

  return { items }
}

async function getStall(openid, data) {
  const stall = await getStallRaw(data.id)
  const admin = await isAdmin(openid)

  if (isLegacyDemo(stall)) throw new Error('这条出摊信息已删除')
  if (stall.status === 'deleted') throw new Error('这条出摊信息已删除')
  if (stall.auditStatus !== 'approved' && stall.ownerOpenid !== openid && !admin) {
    throw new Error('这条出摊信息正在审核')
  }

  const favoriteIds = await getFavoriteVendorIds(openid)
  return {
    item: decorateStall(
      stall,
      favoriteIds,
      optionalCoordinate(data.latitude),
      optionalCoordinate(data.longitude)
    )
  }
}

async function saveProfile(openid, data) {
  const profile = {
    nickname: cleanText(data.nickname || '微信用户', 20),
    avatarUrl: cleanText(data.avatarUrl, 500),
    updatedAt: Date.now()
  }
  await db.collection('users').doc(openid).set({
    data: Object.assign({}, profile, { lastSeenAt: Date.now() })
  })
  return profile
}

async function saveVendor(openid, data) {
  const commonLocation = normalizeLocation(data.commonLocation)
  const vendor = {
    name: cleanText(data.name, 30),
    intro: cleanText(data.intro, 200),
    avatarUrl: cleanText(data.avatarUrl, 500),
    defaultStallName: cleanText(data.defaultStallName, 30),
    defaultCategory: cleanText(data.defaultCategory, 30),
    defaultDescription: cleanText(data.defaultDescription, 300),
    defaultMenuText: cleanText(data.defaultMenuText, 100),
    defaultPriceText: cleanText(data.defaultPriceText, 50),
    defaultNotice: cleanText(data.defaultNotice, 120),
    commonAddress: cleanText(data.commonAddress, 120),
    commonLocation,
    verified: false,
    updatedAt: Date.now()
  }
  if (!vendor.name) throw new Error('请填写摊主名称')
  if (!vendor.defaultCategory) throw new Error('请填写常卖品类')

  const passed = await checkText(openid, [
    vendor.name,
    vendor.intro,
    vendor.defaultStallName,
    vendor.defaultCategory,
    vendor.defaultDescription,
    vendor.defaultMenuText,
    vendor.defaultPriceText,
    vendor.defaultNotice,
    vendor.commonAddress
  ].join('\n'))
  if (passed === false) throw new Error('资料中包含不适合发布的内容')

  try {
    const old = await db.collection('vendors').doc(openid).get()
    vendor.createdAt = old.data.createdAt || Date.now()
  } catch (err) {
    vendor.createdAt = Date.now()
  }

  await db.collection('vendors').doc(openid).set({ data: vendor })
  return vendor
}

async function createStall(openid, data) {
  const vendor = await getVendor(openid)
  if (!vendor) throw new Error('请先完善摊主资料')

  const startAt = Number(data.startAt)
  const endAt = Number(data.endAt)
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt <= startAt) {
    throw new Error('出摊时间不正确')
  }

  const location = normalizeLocation(data.location, data.latitude, data.longitude)
  if (!location) {
    throw new Error('请选择有效的出摊地点')
  }

  const images = Array.isArray(data.images) ? data.images.slice(0, 6) : []
  const now = Date.now()
  const stall = {
    ownerOpenid: openid,
    vendorName: vendor.name,
    vendorAvatar: vendor.avatarUrl || '',
    name: cleanText(data.name, 30),
    category: cleanText(data.category, 20),
    emoji: cleanText(data.emoji, 4) || '🍱',
    description: cleanText(data.description, 300),
    menuText: cleanText(data.menuText, 100),
    priceText: cleanText(data.priceText, 50) || '价格以现场为准',
    notice: cleanText(data.notice, 120),
    address: cleanText(data.address, 120),
    location,
    startAt,
    endAt,
    preciseDuringEvent: Boolean(data.preciseDuringEvent),
    images,
    theme: ['coral', 'mint', 'orange'].includes(data.theme) ? data.theme : 'coral',
    status: 'active',
    favoriteCount: 0,
    clientRequestId: cleanText(data.clientRequestId, 80),
    createdAt: now,
    updatedAt: now
  }

  if (!stall.name || !stall.description || !stall.address) {
    throw new Error('请完整填写名称、介绍和地点')
  }

  stall.publishKey = buildPublishKey(stall)

  // 兼容旧版本已产生的重复记录：同一摊主、同一时间、同一地点和同一场次名称只保留一场。
  const legacyExisting = await findExistingPublish(openid, stall.publishKey)
  if (legacyExisting) {
    await scheduleVendorFollowers(legacyExisting._id, legacyExisting)
    return {
      id: legacyExisting._id,
      auditStatus: legacyExisting.auditStatus || 'approved',
      duplicate: true
    }
  }

  const textPassed = await checkText(openid, [
    stall.name,
    stall.category,
    stall.description,
    stall.menuText,
    stall.priceText,
    stall.notice,
    stall.address
  ].join('\n'))

  if (textPassed === false) throw new Error('发布内容未通过安全检测，请修改后重试')

  stall.auditStatus = 'approved'
  stall.securityStatus = textPassed === true ? 'passed' : 'check_unavailable'
  stall.reviewStatus = images.length ? 'queued' : 'not_required'

  // 使用稳定文档 ID 保证接口幂等：即使网络重试或连续点击，也只会写入同一条记录。
  const documentId = `stall_${crypto.createHash('sha256').update(stall.publishKey).digest('hex').slice(0, 24)}`

  try {
    const existing = await db.collection('stalls').doc(documentId).get()
    if (existing.data && existing.data.status !== 'deleted') {
      await scheduleVendorFollowers(documentId, existing.data)
      return {
        id: documentId,
        auditStatus: existing.data.auditStatus || 'approved',
        duplicate: true
      }
    }
  } catch (err) {
    // 文档不存在时继续创建。
  }

  await db.collection('stalls').doc(documentId).set({ data: stall })
  await scheduleVendorFollowers(documentId, stall)
  return {
    id: documentId,
    auditStatus: stall.auditStatus,
    duplicate: false
  }
}

async function updateStall(openid, data) {
  const stall = await getStallRaw(data.id)
  if (stall.ownerOpenid !== openid && !(await isAdmin(openid))) {
    throw new Error('无权修改这条信息')
  }

  const allowed = [
    'name', 'category', 'emoji', 'description', 'menuText', 'priceText',
    'notice', 'address', 'location', 'startAt', 'endAt',
    'preciseDuringEvent', 'images', 'theme'
  ]
  const patch = {}
  allowed.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(data.patch || {}, key)) {
      patch[key] = data.patch[key]
    }
  })

  if (Object.prototype.hasOwnProperty.call(patch, 'location')) {
    const location = normalizeLocation(patch.location)
    if (!location) throw new Error('请选择有效的出摊地点')
    patch.location = location
  }

  const textPassed = await checkText(openid, JSON.stringify(patch))
  if (textPassed === false) throw new Error('修改内容未通过安全检测')

  patch.updatedAt = Date.now()
  patch.auditStatus = 'approved'
  patch.securityStatus = textPassed === true ? 'passed' : 'check_unavailable'
  patch.reviewStatus = patch.images && patch.images.length ? 'queued' : 'not_required'

  await db.collection('stalls').doc(data.id).update({ data: patch })
  await scheduleVendorFollowers(data.id, Object.assign({}, stall, patch))
  return { id: data.id, auditStatus: patch.auditStatus }
}

async function myStalls(openid) {
  const [result, favoriteIds] = await Promise.all([
    db.collection('stalls')
      .where({ ownerOpenid: openid })
      .limit(100)
      .get(),
    getFavoriteVendorIds(openid)
  ])
  return {
    items: dedupeStallRecords(result.data
      .filter(item => !isLegacyDemo(item))
      .filter(item => item.status !== 'deleted'))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .map(item => decorateStall(item, favoriteIds))
  }
}

async function setStallStatus(openid, data) {
  const stall = await getStallRaw(data.id)
  if (stall.ownerOpenid !== openid && !(await isAdmin(openid))) {
    throw new Error('无权修改这条信息')
  }
  const allowed = ['active', 'cancelled', 'finished']
  if (!allowed.includes(data.status)) throw new Error('状态不正确')
  await db.collection('stalls').doc(data.id).update({
    data: {
      status: data.status,
      updatedAt: Date.now()
    }
  })
  return { ok: true }
}

async function deleteStall(openid, data) {
  const stall = await getStallRaw(data.id)
  if (stall.ownerOpenid !== openid && !(await isAdmin(openid))) {
    throw new Error('无权删除这条信息')
  }
  await db.collection('stalls').doc(data.id).update({
    data: {
      status: 'deleted',
      updatedAt: Date.now()
    }
  })
  return { ok: true }
}

function favoriteDocumentId(openid, vendorOpenid) {
  return `fav_${crypto.createHash('sha256').update(`${openid}|${vendorOpenid}`).digest('hex').slice(0, 28)}`
}

async function cancelVendorSubscriptions(openid, vendorOpenid) {
  const result = await db.collection('subscriptions')
    .where({ ownerOpenid: openid })
    .limit(100)
    .get()

  const targets = result.data.filter(item =>
    item.vendorOpenid === vendorOpenid &&
    ['waiting', 'pending'].includes(item.status)
  )

  await Promise.all(targets.map(item =>
    db.collection('subscriptions').doc(item._id).update({
      data: {
        status: 'cancelled',
        updatedAt: Date.now()
      }
    })
  ))
}

async function toggleFavorite(openid, data) {
  const stall = await getStallRaw(data.id)
  if (!stall || stall.status === 'deleted') throw new Error('摊位不存在')

  const vendorOpenid = stall.ownerOpenid
  const records = await getFavoriteRecords(openid)
  const existing = records.filter(item => item.vendorOpenid === vendorOpenid)

  if (existing.length) {
    await Promise.all(existing.map(item =>
      db.collection('favorites').doc(item._id).remove()
    ))
    await cancelVendorSubscriptions(openid, vendorOpenid)
    return {
      active: false,
      vendorOpenid,
      vendorName: stall.vendorName || '摊主'
    }
  }

  const id = favoriteDocumentId(openid, vendorOpenid)
  await db.collection('favorites').doc(id).set({
    data: {
      ownerOpenid: openid,
      vendorOpenid,
      sourceStallId: data.id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  })

  return {
    active: true,
    vendorOpenid,
    vendorName: stall.vendorName || '摊主'
  }
}

function chooseFavoriteStalls(records, vendorIds) {
  const now = Date.now()
  const chosen = new Map()

  records
    .filter(item => vendorIds.includes(item.ownerOpenid))
    .filter(item => item.status !== 'deleted' && item.auditStatus === 'approved')
    .filter(item => item.endAt >= now - 8 * 60 * 60 * 1000)
    .sort((a, b) => {
      const score = item => item.status === 'active' && now >= item.startAt && now <= item.endAt
        ? 0
        : item.startAt > now ? 1 : 2
      const scoreDiff = score(a) - score(b)
      if (scoreDiff) return scoreDiff
      if (score(a) === 1) return Number(a.startAt || 0) - Number(b.startAt || 0)
      return Number(b.startAt || 0) - Number(a.startAt || 0)
    })
    .forEach(item => {
      if (!chosen.has(item.ownerOpenid)) chosen.set(item.ownerOpenid, item)
    })

  return Array.from(chosen.values())
}

async function favoriteList(openid, data) {
  const favoriteVendorIds = await getFavoriteVendorIds(openid)
  if (!favoriteVendorIds.length) return { items: [] }

  const result = await db.collection('stalls')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()

  const items = chooseFavoriteStalls(
    result.data.filter(item => !isLegacyDemo(item)),
    favoriteVendorIds
  )
    .map(item => decorateStall(
      item,
      favoriteVendorIds,
      optionalCoordinate(data.latitude),
      optionalCoordinate(data.longitude)
    ))

  return { items }
}

async function favoriteDueAlerts(openid) {
  const favoriteVendorIds = await getFavoriteVendorIds(openid)
  if (!favoriteVendorIds.length) return { items: [] }

  const now = Date.now()
  const result = await db.collection('stalls')
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()

  const seenVendors = new Set()
  const items = result.data
    .filter(item => !isLegacyDemo(item))
    .filter(item => favoriteVendorIds.includes(item.ownerOpenid))
    .filter(item => item.auditStatus === 'approved' && item.status === 'active')
    .filter(item => Number(item.startAt) <= now && Number(item.endAt) >= now)
    .filter(item => {
      if (seenVendors.has(item.ownerOpenid)) return false
      seenVendors.add(item.ownerOpenid)
      return true
    })
    .map(item => ({
      _id: item._id,
      name: item.name,
      vendorName: item.vendorName,
      address: item.address,
      startAt: item.startAt,
      endAt: item.endAt,
      timeText: formatRange(item.startAt, item.endAt)
    }))

  return { items }
}

async function findNextVendorStall(vendorOpenid) {
  const result = await db.collection('stalls')
    .where({ ownerOpenid: vendorOpenid })
    .limit(100)
    .get()

  return result.data
    .filter(item => !isLegacyDemo(item))
    .filter(item => item.auditStatus === 'approved' && item.status === 'active')
    .filter(item => Number(item.endAt) > Date.now())
    .sort((a, b) => Number(a.startAt || 0) - Number(b.startAt || 0))[0] || null
}

async function subscribeVendor(openid, data) {
  const vendorOpenid = cleanText(data.vendorOpenid, 128)
  if (!vendorOpenid) throw new Error('摊主身份信息不完整')

  const favoriteVendorIds = await getFavoriteVendorIds(openid)
  if (!favoriteVendorIds.includes(vendorOpenid)) {
    throw new Error('请先关注该摊主')
  }

  const nextStall = await findNextVendorStall(vendorOpenid)
  const id = `sub_${crypto.createHash('sha256').update(`${openid}|${vendorOpenid}`).digest('hex').slice(0, 28)}`
  const now = Date.now()

  await db.collection('subscriptions').doc(id).set({
    data: {
      ownerOpenid: openid,
      vendorOpenid,
      stallId: nextStall ? nextStall._id : '',
      sendAt: nextStall ? Number(nextStall.startAt) : 0,
      status: nextStall ? 'pending' : 'waiting',
      acceptedAt: now,
      createdAt: now,
      updatedAt: now
    }
  })

  return {
    ok: true,
    scheduled: Boolean(nextStall),
    stallId: nextStall ? nextStall._id : ''
  }
}

async function scheduleVendorFollowers(stallId, stall) {
  const result = await db.collection('subscriptions')
    .where({ vendorOpenid: stall.ownerOpenid })
    .limit(100)
    .get()

  const waiting = result.data.filter(item =>
    item.status === 'waiting' || (item.status === 'pending' && item.stallId === stallId)
  )
  await Promise.all(waiting.map(item =>
    db.collection('subscriptions').doc(item._id).update({
      data: {
        stallId,
        sendAt: Number(stall.startAt),
        status: 'pending',
        updatedAt: Date.now()
      }
    })
  ))
}

async function report(openid, data) {
  const reason = cleanText(data.reason, 40)
  const detail = cleanText(data.detail, 300)
  if (!reason) throw new Error('请选择举报原因')

  const passed = await checkText(openid, `${reason}\n${detail}`)
  if (passed === false) throw new Error('举报说明包含不适合提交的内容')

  await db.collection('reports').add({
    data: {
      ownerOpenid: openid,
      stallId: cleanText(data.stallId, 80),
      reason,
      detail,
      status: 'pending',
      createdAt: Date.now()
    }
  })
  return { ok: true }
}

async function requireAdmin(openid) {
  const record = await getAdminRecord(openid)
  if (!record) throw new Error('当前账号不是管理员')
  return record
}

async function requireSuperAdmin(openid) {
  const record = await requireAdmin(openid)
  if (record.role !== 'super_admin') throw new Error('只有超级管理员可以管理管理员')
  return record
}

async function adminList(openid) {
  const currentAdmin = await requireAdmin(openid)
  const tasks = [
    db.collection('stalls').where({ auditStatus: 'pending' }).limit(100).get(),
    db.collection('reports').where({ status: 'pending' }).limit(100).get()
  ]
  if (currentAdmin.role === 'super_admin') {
    tasks.push(db.collection('admins').limit(100).get())
  }

  const results = await Promise.all(tasks)
  const pending = results[0]
  const reports = results[1]
  const admins = results[2]

  return {
    pending: pending.data
      .filter(item => !isLegacyDemo(item))
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
      .map(item => Object.assign({}, item, {
        categoryIcon: categoryIconPath(item.category)
      })),
    reports: reports.data
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)),
    isSuperAdmin: currentAdmin.role === 'super_admin',
    admins: admins
      ? admins.data
        .filter(item => item.enabled !== false)
        .map(item => ({
          openid: item._id,
          name: item.name || (item.role === 'super_admin' ? '超级管理员' : '运营管理员'),
          role: item.role || 'admin',
          createdAt: item.createdAt || 0
        }))
        .sort((a, b) => {
          if (a.role !== b.role) return a.role === 'super_admin' ? -1 : 1
          return Number(a.createdAt || 0) - Number(b.createdAt || 0)
        })
      : []
  }
}

async function adminAdd(openid, data) {
  await requireSuperAdmin(openid)
  const targetOpenid = cleanText(data.openid, 128)
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(targetOpenid)) {
    throw new Error('身份编号格式不正确，请完整粘贴用户 OpenID')
  }

  const existing = await getAdminRecord(targetOpenid)
  if (existing) return { ok: true, duplicate: true }

  await db.collection('admins').doc(targetOpenid).set({
    data: {
      role: 'admin',
      name: cleanText(data.name, 30) || '运营管理员',
      enabled: true,
      createdBy: openid,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
  })
  return { ok: true, duplicate: false }
}

async function adminRemove(openid, data) {
  await requireSuperAdmin(openid)
  const targetOpenid = cleanText(data.openid, 128)
  if (!targetOpenid) throw new Error('管理员身份编号不能为空')
  if (targetOpenid === openid) throw new Error('不能移除自己的超级管理员身份')

  const target = await getAdminRecord(targetOpenid)
  if (!target) return { ok: true }
  if (target.role === 'super_admin') throw new Error('不能移除超级管理员')

  await db.collection('admins').doc(targetOpenid).remove()
  return { ok: true }
}

async function adminAuditStall(openid, data) {
  await requireAdmin(openid)
  if (!['approved', 'rejected'].includes(data.result)) throw new Error('审核结果不正确')
  await db.collection('stalls').doc(data.id).update({
    data: {
      auditStatus: data.result,
      auditRemark: cleanText(data.remark, 120),
      auditedBy: openid,
      auditedAt: Date.now(),
      updatedAt: Date.now()
    }
  })
  return { ok: true }
}

async function adminHandleReport(openid, data) {
  await requireAdmin(openid)
  if (!['handled', 'dismissed'].includes(data.status)) throw new Error('处理状态不正确')
  await db.collection('reports').doc(data.id).update({
    data: {
      status: data.status,
      handledBy: openid,
      handledAt: Date.now()
    }
  })
  return { ok: true }
}


async function cleanupDuplicateStalls(openid) {
  const result = await db.collection('stalls')
    .where({ ownerOpenid: openid })
    .limit(100)
    .get()

  const groups = new Map()
  result.data
    .filter(item => !isLegacyDemo(item))
    .filter(item => item.status !== 'deleted')
    .forEach(item => {
      const key = item.publishKey || buildPublishKey(item)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    })

  let removed = 0
  for (const records of groups.values()) {
    if (records.length < 2) continue

    records.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    const keeper = records[0]
    const duplicates = records.slice(1)

    for (const item of duplicates) {
      await db.collection('stalls').doc(item._id).update({
        data: {
          status: 'deleted',
          duplicateOf: keeper._id,
          updatedAt: Date.now()
        }
      })
      removed += 1
    }
  }

  return { removed }
}

async function cleanupLegacyDemo() {
  const ids = [
    'review_demo_001',
    'review_demo_002',
    'review_demo_003',
    'demo_001',
    'demo_002',
    'demo_003'
  ]

  let removed = 0

  for (const id of ids) {
    try {
      await db.collection('stalls').doc(id).remove()
      removed += 1
    } catch (err) {
      // The record may already be absent.
    }
  }

  return { removed }
}

const handlers = {
  me,
  listStalls,
  getStall,
  saveProfile,
  saveVendor,
  createStall,
  updateStall,
  myStalls,
  setStallStatus,
  deleteStall,
  toggleFavorite,
  favoriteList,
  favoriteDueAlerts,
  report,
  subscribeVendor,
  adminList,
  adminAdd,
  adminRemove,
  adminAuditStall,
  adminHandleReport,
  cleanupDuplicateStalls,
  cleanupLegacyDemo
}

exports.main = async (event) => {
  const context = cloud.getWXContext()
  const action = event.action
  const data = event.data || {}
  const handler = handlers[action]

  if (!handler) {
    return { ok: false, message: `未知操作：${action}` }
  }

  try {
    const result = await handler(context.OPENID, data)
    return { ok: true, data: result }
  } catch (err) {
    console.error(action, err)
    return {
      ok: false,
      message: err.message || '服务暂时不可用'
    }
  }
}

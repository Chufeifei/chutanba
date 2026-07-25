const { distanceKm, formatDistance } = require('../utils/geo')
const { formatRange } = require('../utils/date')
const { categoryIconPath } = require('../utils/categories')

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function decorate(stall, latitude, longitude, favoriteVendorIds = []) {
  const item = clone(stall)
  const now = Date.now()

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

  const km = hasViewerLocation
    ? distanceKm(
        Number(latitude),
        Number(longitude),
        Number(item.location && item.location.latitude),
        Number(item.location && item.location.longitude)
      )
    : null

  item.distanceKm = km
  item.distanceText = formatDistance(km)
  item.vendorId = item.ownerOpenid || item.vendorId || ''
  item.isFavorite = favoriteVendorIds.includes(item.vendorId)
  item.categoryIcon = categoryIconPath(item.category)

  return item
}

module.exports = {
  clone,
  decorate
}

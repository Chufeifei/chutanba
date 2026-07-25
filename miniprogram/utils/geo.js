function toRad(value) {
  return value * Math.PI / 180
}

function distanceKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => typeof v !== 'number')) return null
  const radius = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(km) {
  if (km === null || km === undefined) return '距离未知'
  if (km < 1) return `${Math.max(10, Math.round(km * 1000 / 10) * 10)}m`
  return `${km.toFixed(km < 10 ? 1 : 0)}km`
}

module.exports = {
  distanceKm,
  formatDistance
}

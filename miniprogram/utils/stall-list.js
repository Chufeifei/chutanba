function text(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function coordinate(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(5) : ''
}

function fallbackKey(item = {}) {
  const location = item.location || {}
  return [
    text(item.name),
    text(item.category),
    text(item.address),
    coordinate(location.latitude),
    coordinate(location.longitude),
    String(Number(item.startAt) || 0),
    String(Number(item.endAt) || 0)
  ].join('|')
}

function dedupeStalls(items = []) {
  const unique = new Map()

  ;(Array.isArray(items) ? items : []).forEach(item => {
    const key = item.publishKey || fallbackKey(item)
    const existing = unique.get(key)
    if (!existing || Number(item.createdAt || 0) > Number(existing.createdAt || 0)) {
      unique.set(key, item)
    }
  })

  return Array.from(unique.values())
}

module.exports = {
  dedupeStalls
}

const cache = Object.create(null)

const dirty = {
  stalls: true,
  favorites: true,
  me: true,
  myStalls: true,
  vendor: true,
  admin: true,
  detail: true
}

let lastLocation = null

const TTL = {
  listStalls: 2 * 60 * 1000,
  favoriteList: 2 * 60 * 1000,
  favoriteDueAlerts: 30 * 1000,
  me: 5 * 60 * 1000,
  myStalls: 2 * 60 * 1000,
  getStall: 60 * 1000,
  adminList: 30 * 1000
}

function stableStringify(value) {
  if (value === null || value === undefined) return String(value)
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${key}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function cacheKey(action, data = {}) {
  return `${action}:${stableStringify(data)}`
}

function get(action, data = {}) {
  const key = cacheKey(action, data)
  const entry = cache[key]
  if (!entry) return null

  const ttl = TTL[action] || 60 * 1000
  if (Date.now() - entry.savedAt > ttl) {
    delete cache[key]
    return null
  }

  return entry.value
}

function set(action, data = {}, value) {
  cache[cacheKey(action, data)] = {
    value,
    savedAt: Date.now()
  }
}

function clearAction(action) {
  const prefix = `${action}:`
  Object.keys(cache).forEach(key => {
    if (key.startsWith(prefix)) delete cache[key]
  })
}

function markDirty(...groups) {
  groups.forEach(group => {
    dirty[group] = true
  })
}

function markClean(group) {
  dirty[group] = false
}

function isDirty(group) {
  return dirty[group] !== false
}

function invalidate(groups = []) {
  const list = Array.isArray(groups) ? groups : [groups]

  list.forEach(group => {
    dirty[group] = true

    if (group === 'stalls') {
      clearAction('listStalls')
      clearAction('getStall')
      clearAction('favoriteDueAlerts')
      dirty.detail = true
    }

    if (group === 'favorites') {
      clearAction('favoriteList')
      clearAction('listStalls')
      clearAction('getStall')
      clearAction('favoriteDueAlerts')
      dirty.detail = true
    }

    if (group === 'me' || group === 'vendor') {
      clearAction('me')
    }

    if (group === 'myStalls') {
      clearAction('myStalls')
    }

    if (group === 'admin') {
      clearAction('adminList')
    }
  })
}

function setLocation(location) {
  if (!location) return
  lastLocation = {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    savedAt: Date.now()
  }
}

function getLocation(maxAge = 30 * 60 * 1000) {
  if (!lastLocation) return null
  if (Date.now() - lastLocation.savedAt > maxAge) return null
  return {
    latitude: lastLocation.latitude,
    longitude: lastLocation.longitude
  }
}

module.exports = {
  get,
  set,
  clearAction,
  invalidate,
  markDirty,
  markClean,
  isDirty,
  setLocation,
  getLocation
}

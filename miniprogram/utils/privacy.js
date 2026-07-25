function ensurePrivacyAuthorize() {
  return new Promise((resolve, reject) => {
    if (!wx.getPrivacySetting || !wx.requirePrivacyAuthorize) {
      resolve()
      return
    }

    wx.getPrivacySetting({
      success(res) {
        if (!res.needAuthorization) {
          resolve()
          return
        }
        wx.requirePrivacyAuthorize({
          success: resolve,
          fail: reject
        })
      },
      fail: reject
    })
  })
}

function getLocation() {
  return ensurePrivacyAuthorize().then(() => new Promise((resolve, reject) => {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      success: resolve,
      fail: reject
    })
  }))
}

function chooseLocation() {
  return ensurePrivacyAuthorize().then(() => new Promise((resolve, reject) => {
    wx.chooseLocation({
      success: resolve,
      fail: reject
    })
  }))
}

module.exports = {
  ensurePrivacyAuthorize,
  getLocation,
  chooseLocation
}

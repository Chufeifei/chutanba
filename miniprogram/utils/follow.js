const api = require('./api')
const config = require('../config')

function requestPermission() {
  return new Promise((resolve, reject) => {
    wx.requestSubscribeMessage({
      tmplIds: [config.REMINDER_TEMPLATE_ID],
      success: resolve,
      fail: reject
    })
  })
}

function saveSubscription(vendorOpenid, permissionResult) {
  if (!permissionResult || permissionResult[config.REMINDER_TEMPLATE_ID] !== 'accept') {
    wx.showToast({ title: '已关注，消息提醒未开启', icon: 'none' })
    return Promise.resolve({ subscribed: false })
  }

  return api.call('subscribeVendor', { vendorOpenid }).then(schedule => {
    wx.showToast({
      title: schedule.scheduled ? '下次出摊会提醒' : '已等待下次出摊',
      icon: 'success'
    })
    return { subscribed: true, schedule }
  })
}

function showInAppReminder(vendorName) {
  wx.showModal({
    title: '已开启小程序内提醒',
    content: `已关注${vendorName || '该摊主'}。摊主出摊时，只要小程序处于前台，或你重新打开小程序，就会弹窗提醒。`,
    showCancel: false
  })
}

function requestSubscribe(vendorOpenid, vendorName = '该摊主') {
  if (!vendorOpenid) {
    wx.showToast({ title: '摊主信息不完整', icon: 'none' })
    return Promise.resolve({ subscribed: false })
  }

  if (!config.REMINDER_TEMPLATE_ID) {
    showInAppReminder(vendorName)
    return Promise.resolve({ subscribed: false, inAppOnly: true })
  }

  return requestPermission()
    .then(result => saveSubscription(vendorOpenid, result))
    .catch(err => {
      wx.showToast({ title: err.message || '提醒设置未完成', icon: 'none' })
      return { subscribed: false, error: err }
    })
}

function toggle(stallId, context = {}) {
  const shouldRequestPermission = !context.isFavorite && Boolean(config.REMINDER_TEMPLATE_ID)
  // 必须在用户点击事件中立刻调起订阅授权，避免异步云函数返回后失去手势上下文。
  const permissionPromise = shouldRequestPermission
    ? requestPermission().catch(err => ({ __error: err }))
    : Promise.resolve(null)

  return api.call('toggleFavorite', { id: stallId }).then(result => {
    if (!result.active) {
      wx.showToast({ title: '已取消关注', icon: 'none' })
      return result
    }

    wx.showToast({ title: '已关注摊主', icon: 'success' })

    if (!config.REMINDER_TEMPLATE_ID) {
      showInAppReminder(result.vendorName)
      return result
    }

    return permissionPromise.then(permission => {
      if (permission && permission.__error) {
        wx.showToast({ title: '已关注，提醒设置未完成', icon: 'none' })
        return result
      }
      return saveSubscription(result.vendorOpenid, permission).then(() => result)
    })
  })
}

module.exports = {
  toggle,
  requestSubscribe
}

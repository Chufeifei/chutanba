const api = require('../../utils/api')

Page({
  data: {
    loading: true,
    active: 'pending',
    pending: [],
    reports: [],
    admins: [],
    isSuperAdmin: false,
    adminOpenid: '',
    adminName: ''
  },

  onLoad() {
    this.load()
  },

  onPullDownRefresh() {
    this.load(false).finally(() => wx.stopPullDownRefresh())
  },

  load(showLoading = true) {
    if (showLoading) this.setData({ loading: true })
    return api.call('adminList', {}, { force: true }).then(res => {
      this.setData({
        pending: res.pending || [],
        reports: res.reports || [],
        admins: res.admins || [],
        isSuperAdmin: Boolean(res.isSuperAdmin)
      })
    }).catch(err => {
      wx.showModal({
        title: '无权访问',
        content: err.message || '当前账号不是管理员',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    }).finally(() => this.setData({ loading: false }))
  },

  changeTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === 'admins' && !this.data.isSuperAdmin) return
    this.setData({ active: tab })
  },

  onAdminOpenidInput(e) {
    this.setData({ adminOpenid: String(e.detail.value || '').trim() })
  },

  onAdminNameInput(e) {
    this.setData({ adminName: e.detail.value || '' })
  },

  pasteAdminOpenid() {
    wx.getClipboardData({
      success: res => this.setData({ adminOpenid: String(res.data || '').trim() })
    })
  },

  addAdmin() {
    const openid = String(this.data.adminOpenid || '').trim()
    if (!openid) {
      wx.showToast({ title: '请粘贴用户身份编号', icon: 'none' })
      return
    }

    wx.showModal({
      title: '添加管理员',
      content: `确认将 ${openid} 设置为运营管理员？`,
      success: result => {
        if (!result.confirm) return
        wx.showLoading({ title: '正在添加' })
        api.call('adminAdd', {
          openid,
          name: String(this.data.adminName || '').trim()
        }).then(res => {
          wx.showToast({
            title: res.duplicate ? '已经是管理员' : '添加成功',
            icon: res.duplicate ? 'none' : 'success'
          })
          this.setData({ adminOpenid: '', adminName: '' })
          return this.load(false)
        }).catch(err => {
          wx.showToast({ title: err.message || '添加失败', icon: 'none' })
        }).finally(() => wx.hideLoading())
      }
    })
  },

  removeAdmin(e) {
    const openid = e.currentTarget.dataset.openid
    const name = e.currentTarget.dataset.name || '该管理员'
    wx.showModal({
      title: '移除管理员',
      content: `确认移除“${name}”的管理员权限？`,
      confirmColor: '#d85b4f',
      success: result => {
        if (!result.confirm) return
        api.call('adminRemove', { openid }).then(() => {
          wx.showToast({ title: '已移除', icon: 'success' })
          return this.load(false)
        }).catch(err => {
          wx.showToast({ title: err.message || '移除失败', icon: 'none' })
        })
      }
    })
  },

  copyAdminOpenid(e) {
    wx.setClipboardData({ data: e.currentTarget.dataset.openid })
  },

  audit(e) {
    const id = e.currentTarget.dataset.id
    const result = e.currentTarget.dataset.result
    const approved = result === 'approved'
    wx.showModal({
      title: approved ? '通过这条内容？' : '驳回这条内容？',
      editable: true,
      placeholderText: approved ? '可选：填写审核备注' : '请填写驳回原因',
      success: res => {
        if (!res.confirm) return
        if (!approved && !String(res.content || '').trim()) {
          wx.showToast({ title: '请填写驳回原因', icon: 'none' })
          return
        }
        api.call('adminAuditStall', {
          id,
          result,
          remark: String(res.content || '').trim()
        }).then(() => this.load(false))
      }
    })
  },

  handleReport(e) {
    const id = e.currentTarget.dataset.id
    const status = e.currentTarget.dataset.status
    api.call('adminHandleReport', { id, status }).then(() => this.load(false))
  }
})

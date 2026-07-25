Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/home/index',
        text: '找摊',
        iconPath: '/assets/icons/nav-home.png'
      },
      {
        pagePath: '/pages/map/index',
        text: '地图',
        iconPath: '/assets/icons/nav-map.png'
      },
      {
        pagePath: '/pages/publish/index',
        text: '出摊',
        iconPath: '/assets/icons/nav-publish.png'
      },
      {
        pagePath: '/pages/favorite/index',
        text: '关注',
        iconPath: '/assets/icons/nav-favorite.png'
      },
      {
        pagePath: '/pages/mine/index',
        text: '我的',
        iconPath: '/assets/icons/nav-mine.png'
      }
    ]
  },

  methods: {
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index)
      const item = this.data.list[index]
      if (!item || index === this.data.selected) return

      const previous = this.data.selected
      this.setData({ selected: index })

      wx.switchTab({
        url: item.pagePath,
        fail: () => {
          this.setData({ selected: previous })
        }
      })
    }
  }
})

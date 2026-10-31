Component({
  data: { selected: 0 },
  methods: {
    switchTab(event) {
      wx.switchTab({ url: event.currentTarget.dataset.path });
    },
  },
});

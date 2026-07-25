Component({
  properties: {
    stall: {
      type: Object,
      value: {}
    }
  },

  methods: {
    open() {
      this.triggerEvent('open', { id: this.data.stall._id })
    },

    favorite() {
      this.triggerEvent('favorite', {
        id: this.data.stall._id,
        vendorId: this.data.stall.vendorId,
        vendorName: this.data.stall.vendorName,
        isFavorite: Boolean(this.data.stall.isFavorite)
      })
    }
  }
})

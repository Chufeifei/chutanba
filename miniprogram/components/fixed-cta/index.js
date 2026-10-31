Component({
  properties: {
    primaryText: { type: String, value: '' },
    secondaryText: { type: String, value: '' },
    disabled: { type: Boolean, value: false },
    processing: { type: Boolean, value: false },
  },
  methods: {
    onPrimary() { if (!this.properties.disabled && !this.properties.processing) this.triggerEvent('primary'); },
    onSecondary() { if (!this.properties.processing) this.triggerEvent('secondary'); },
  },
});

Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    description: { type: String, value: '' },
    confirmText: { type: String, value: '确认' },
    cancelText: { type: String, value: '取消' },
    processing: { type: Boolean, value: false },
    destructive: { type: Boolean, value: false },
  },
  methods: {
    onConfirm() { if (!this.properties.processing) this.triggerEvent('confirm'); },
    onCancel() { if (!this.properties.processing) this.triggerEvent('cancel'); },
    preventClose() {},
  },
});

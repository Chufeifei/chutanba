const { VIEW_STATE } = require('../../utils/view-state');

Component({
  properties: {
    type: { type: String, value: VIEW_STATE.EMPTY },
    title: { type: String, value: '' },
    description: { type: String, value: '' },
    actionText: { type: String, value: '' },
  },
  data: { viewState: VIEW_STATE },
  methods: {
    onAction() { this.triggerEvent('action', { type: this.properties.type }); },
  },
});

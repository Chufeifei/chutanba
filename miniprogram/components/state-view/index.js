/**
 * 通用状态视图组件。
 *
 * 十个状态的图标与配色在这里统一决定，页面只传 type + 文案。
 * 页面不要自己拼"错误图标 + 提示语"，否则同一个错误在不同页面长得不一样。
 */
const { VIEW_STATE } = require('../../utils/view-state');

// 图标与是否转圈由状态决定：转圈的只有"正在进行中"的两种状态
const STATE_MARK = Object.freeze({
  [VIEW_STATE.LOADING]: { mark: '', spinning: true, tone: 'busy' },
  [VIEW_STATE.EMPTY]: { mark: '•', spinning: false, tone: 'neutral' },
  [VIEW_STATE.STALE]: { mark: '↻', spinning: false, tone: 'warning' },
  [VIEW_STATE.PERMISSION]: { mark: '!', spinning: false, tone: 'neutral' },
  [VIEW_STATE.RETRYABLE_ERROR]: { mark: '↻', spinning: false, tone: 'warning' },
  [VIEW_STATE.TERMINAL_ERROR]: { mark: '•', spinning: false, tone: 'neutral' },
  [VIEW_STATE.WRITE_PENDING]: { mark: '', spinning: true, tone: 'busy' },
  [VIEW_STATE.WRITE_UNKNOWN]: { mark: '?', spinning: false, tone: 'warning' },
  [VIEW_STATE.CONFLICT]: { mark: '!', spinning: false, tone: 'warning' },
});

Component({
  properties: {
    type: { type: String, value: VIEW_STATE.EMPTY },
    title: { type: String, value: '' },
    description: { type: String, value: '' },
    actionText: { type: String, value: '' },
  },

  data: {
    mark: '•',
    spinning: false,
    tone: 'neutral',
  },

  observers: {
    type(value) {
      const preset = STATE_MARK[value] || STATE_MARK[VIEW_STATE.EMPTY];
      this.setData({ mark: preset.mark, spinning: preset.spinning, tone: preset.tone });
    },
  },

  methods: {
    onAction() {
      this.triggerEvent('action', { type: this.properties.type });
    },
  },
});

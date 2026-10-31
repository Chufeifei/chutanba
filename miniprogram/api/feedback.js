const { get, post } = require('../utils/request');

/** 现场状态反馈（仅出摊中摊主）。 */
function submitStatusFeedback(payload) {
  return post('/api/v2/field-feedback', {
    vendorId: payload.vendorUserId,
    feedbackType: payload.feedbackType,
    content: payload.content,
    photo: payload.photo,
    location: payload.location,
  });
}

function listEligibleVendors() {
  return get('/api/v2/field-feedback/candidates');
}

function listMine() {
  return get('/api/v2/field-feedback');
}

/** 内容举报。 */
function submitReport(payload) {
  return post('/api/v2/reports', {
    vendorId: payload.targetUserId,
    targetType: payload.targetType,
    content: payload.content,
  });
}

/** 查看反馈状态（R2）。 */
function getFeedbackStatus(id) {
  return get(`/api/v2/field-feedback/${id}`);
}

/** 查看举报状态（R4）。 */
function getReportStatus(id) {
  return get(`/api/v2/reports/${id}`);
}

module.exports = {
  submitStatusFeedback, listEligibleVendors, listMine,
  submitReport, getFeedbackStatus, getReportStatus,
};

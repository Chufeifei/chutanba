function pad(value) {
  return String(value).padStart(2, '0')
}

function formatDate(timestamp) {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatTime(timestamp) {
  const d = new Date(timestamp)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDateTime(timestamp) {
  const d = new Date(timestamp)
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return `${sameDay ? '今天' : `${d.getMonth() + 1}月${d.getDate()}日`} ${formatTime(timestamp)}`
}

function formatRange(startAt, endAt) {
  if (!startAt || !endAt) return '时间待定'
  const start = new Date(startAt)
  const end = new Date(endAt)
  const sameDay = formatDate(startAt) === formatDate(endAt)
  if (sameDay) {
    return `${formatDateTime(startAt)} - ${formatTime(endAt)}`
  }
  return `${formatDateTime(startAt)} - ${formatDateTime(endAt)}`
}

function buildTimestamp(dateString, timeString) {
  const dateParts = dateString.split('-').map(Number)
  const timeParts = timeString.split(':').map(Number)
  return new Date(
    dateParts[0],
    dateParts[1] - 1,
    dateParts[2],
    timeParts[0],
    timeParts[1],
    0,
    0
  ).getTime()
}

function defaultFormTime() {
  const now = Date.now()
  const start = now + 60 * 60 * 1000
  const end = start + 3 * 60 * 60 * 1000
  return {
    date: formatDate(start),
    startTime: formatTime(start),
    endTime: formatTime(end)
  }
}

module.exports = {
  pad,
  formatDate,
  formatTime,
  formatDateTime,
  formatRange,
  buildTimestamp,
  defaultFormTime
}

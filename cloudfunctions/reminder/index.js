const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatTime(timestamp) {
  const d = new Date(timestamp)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

exports.main = async () => {
  const templateId = process.env.REMINDER_TEMPLATE_ID
  if (!templateId) {
    console.warn('REMINDER_TEMPLATE_ID is not configured')
    return { sent: 0, skipped: true }
  }

  const now = Date.now()
  const due = await db.collection('subscriptions')
    .where({
      status: 'pending',
      sendAt: _.gte(now - 10 * 60 * 1000).and(_.lte(now))
    })
    .limit(50)
    .get()

  let sent = 0
  for (const subscription of due.data) {
    try {
      const stallResult = await db.collection('stalls').doc(subscription.stallId).get()
      const stall = stallResult.data
      if (!stall || stall.auditStatus !== 'approved' || stall.status !== 'active') {
        await db.collection('subscriptions').doc(subscription._id).update({
          data: { status: 'cancelled', updatedAt: Date.now() }
        })
        continue
      }

      await cloud.openapi.subscribeMessage.send({
        touser: subscription.ownerOpenid,
        page: `pages/detail/index?id=${stall._id}`,
        lang: 'zh_CN',
        miniprogramState: 'formal',
        templateId,
        data: {
          thing1: { value: String(stall.name || '出摊提醒').slice(0, 20) },
          time2: { value: formatTime(stall.startAt) },
          thing3: { value: String(stall.address || '查看详情').slice(0, 20) }
        }
      })

      await db.collection('subscriptions').doc(subscription._id).update({
        data: { status: 'sent', sentAt: Date.now() }
      })
      sent += 1
    } catch (err) {
      console.error('send reminder failed', subscription._id, err)
      await db.collection('subscriptions').doc(subscription._id).update({
        data: {
          status: 'failed',
          errorMessage: String(err.message || err).slice(0, 200),
          updatedAt: Date.now()
        }
      })
    }
  }

  return { sent, total: due.data.length }
}

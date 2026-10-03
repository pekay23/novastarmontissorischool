import { http, HttpResponse } from 'msw'

const NOTIFICATIONS_BASE = '/api/notifications'

interface Notification {
  id: string
  tenantId: string
  schoolId: string
  userId: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  isRead: boolean
  readAt: string | null
  createdAt: string
}

const notificationFixtures: Notification[] = [
  {
    id: 'test_notification_1',
    tenantId: 'test_tenant_1',
    schoolId: 'test_school_1',
    userId: 'test_user_1',
    type: 'FEE_DUE',
    title: 'Fee Payment Due',
    body: 'Your tuition fee of GH₵1,500.00 is due on 2024-10-15',
    data: { invoiceId: 'test_invoice_1', amount: 150000 },
    isRead: false,
    readAt: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'test_notification_2',
    tenantId: 'test_tenant_1',
    schoolId: 'test_school_1',
    userId: 'test_user_1',
    type: 'GRADE_POSTED',
    title: 'New Grade Posted',
    body: 'Mathematics assessment grade has been posted',
    data: { assessmentId: 'test_assessment_1', grade: 'A' },
    isRead: true,
    readAt: new Date(Date.now() - 86400000).toISOString(),
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
]

export const notificationHandlers = [
  // GET /api/notifications
  http.get(NOTIFICATIONS_BASE, ({ request }) => {
    const url = new URL(request.url)
    const userId = url.searchParams.get('userId')
    const isRead = url.searchParams.get('isRead')
    const page = Number(url.searchParams.get('page') ?? '1')
    const limit = Number(url.searchParams.get('limit') ?? '20')

    let notifications = [...notificationFixtures]
    if (userId) {
      notifications = notifications.filter((n) => n.userId === userId)
    }
    if (isRead !== null) {
      notifications = notifications.filter((n) => n.isRead === (isRead === 'true'))
    }

    const start = (page - 1) * limit
    const paginated = notifications.slice(start, start + limit)

    return HttpResponse.json({
      data: paginated,
      meta: {
        page,
        limit,
        total: notifications.length,
        totalPages: Math.ceil(notifications.length / limit),
        hasNext: start + limit < notifications.length,
        hasPrev: page > 1,
      },
    })
  }),

  // PATCH /api/notifications/:id (mark as read)
  http.patch(`${NOTIFICATIONS_BASE}/:id`, ({ params }) => {
    const index = notificationFixtures.findIndex((n) => n.id === params.id)
    if (index === -1) {
      return HttpResponse.json(
        { error: 'Notification not found', code: 'NOTIFICATION_NOT_FOUND' },
        { status: 404 }
      )
    }
    notificationFixtures[index] = {
      ...notificationFixtures[index],
      isRead: true,
      readAt: new Date().toISOString(),
    }
    return HttpResponse.json(notificationFixtures[index])
  }),

  // POST /api/notifications (create notification)
  http.post(NOTIFICATIONS_BASE, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    const notification: Notification = {
      id: `test_notification_${notificationFixtures.length + 1}`,
      tenantId: 'test_tenant_1',
      schoolId: 'test_school_1',
      ...body,
      isRead: false,
      readAt: null,
      createdAt: new Date().toISOString(),
    } as Notification
    notificationFixtures.push(notification)
    return HttpResponse.json(notification, { status: 201 })
  }),

  // Unknown notification routes return 404-shaped body
  http.all(`${NOTIFICATIONS_BASE}/*`, () => {
    return HttpResponse.json(
      { error: 'Not found', code: 'NOTIFICATION_ROUTE_NOT_FOUND' },
      { status: 404 }
    )
  }),
]
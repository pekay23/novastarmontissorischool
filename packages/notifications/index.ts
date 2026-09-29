// ============================================================================
// Notifications System — Email, Push, In-App
// ============================================================================

import { Resend } from 'resend'
import { prisma } from '@novastar/database'
import type { NotificationType } from '@novastar/shared-types'

// Lazy-initialized Resend client to avoid module-load-time API key requirement
let _resend: Resend | null = null

function getResend(): Resend {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error('RESEND_API_KEY not configured. Set it in .env to enable email sending.')
    }
    _resend = new Resend(apiKey)
  }
  return _resend
}

// --- Email ---

export interface EmailOptions {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from?: string
  tags?: Array<{ name: string; value: string }>
}

export async function sendEmail(options: EmailOptions): Promise<{ id: string } | null> {
  try {
    const result = await getResend().emails.send({
      from: options.from || 'Novastar Montessori <noreply@novastarmontessori.com>',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text ?? '',
      tags: options.tags,
    })

    if (result.error) {
      console.error('Email send failed:', result.error)
      return null
    }

    return { id: result.data!.id }
  } catch (error) {
    console.error('Email error:', error)
    return null
  }
}

// --- In-App Notifications ---

export interface CreateNotificationInput {
  userId: string
  type: NotificationType
  title: string
  body: string
  data?: Record<string, unknown>
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column
      type: input.type as any,
      title: input.title,
      body: input.body,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column
      data: input.data as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma data object
    } as any,
  })
}

// --- Push Notifications ---

export interface PushSubscriptionInput {
  userId: string
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export async function savePushSubscription(input: PushSubscriptionInput): Promise<void> {
  // Store in database for later push sending
  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: 'SYSTEM',
      title: 'Push Subscription',
      body: JSON.stringify(input),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column
      data: { subscription: input } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma data object
    } as any,
  })
}

// --- Notification Templates ---

export interface NotificationTemplate {
  type: NotificationType
  titleEn: string
  titleTw?: string
  bodyEn: string
  bodyTw?: string
  mergeFields: string[]
}

export const NOTIFICATION_TEMPLATES: Record<NotificationType, NotificationTemplate> = {
  FEE_DUE: {
    type: 'FEE_DUE',
    titleEn: 'Fee Payment Due',
    titleTw: 'Sika Yie Wɔ Mu',
    bodyEn: 'Dear {parentName}, {studentName}\'s school fees of ₵{amount} are due on {dueDate}. Please make the payment at your earliest convenience.',
    bodyTw: 'Ɛte sɛn {parentName}, {studentName} kurasu yie wɔ {dueDate} mu. Ɛyɛ {amount} sika. Mepa sɛn kyerɛw.',
    mergeFields: ['parentName', 'studentName', 'amount', 'dueDate'],
  },
  FEE_OVERDUE: {
    type: 'FEE_OVERDUE',
    titleEn: 'Fee Payment Overdue',
    titleTw: 'Sika Yie Di Dɛɛ',
    bodyEn: 'Dear {parentName}, {studentName}\'s fee payment of ₵{amount} is overdue. Please make the payment as soon as possible.',
    bodyTw: 'Ɛte sɛn {parentName}, {studentName} kurasu yie di {amount}. Mepa sɛn kyerɛw.',
    mergeFields: ['parentName', 'studentName', 'amount', 'daysOverdue'],
  },
  PAYMENT_RECEIVED: {
    type: 'PAYMENT_RECEIVED',
    titleEn: 'Payment Received',
    titleTw: 'Sika Aka Faa',
    bodyEn: 'Dear {parentName}, we have received your payment of ₵{amount} from {studentName}\'s account. Thank you.',
    bodyTw: 'Ɛte sɛn {parentName}, yɛfaa {amount} firi {studentName}. Medaase.',
    mergeFields: ['parentName', 'studentName', 'amount', 'paymentMethod'],
  },
  ATTENDANCE_ALERT: {
    type: 'ATTENDANCE_ALERT',
    titleEn: 'Attendance Alert',
    titleTw: 'Surokwaa Mbu Suuru',
    bodyEn: '{studentName} was absent from class today. Please contact the school if this was unexpected.',
    bodyTw: '{studentName} na ɔwaa sri klas mu. Frɛ sɛn kɔkɔɔ.',
    mergeFields: ['studentName', 'date', 'consecutiveDays'],
  },
  GRADE_POSTED: {
    type: 'GRADE_POSTED',
    titleEn: 'New Grade Posted',
    titleTw: 'Nsa Ne Sob No So',
    bodyEn: '{studentName} has new grades available for review. Subject: {subject}, Score: {score}/100, Grade: {grade}',
    bodyTw: '{studentName} wɔ havi na {subject}, {score}/100, {grade}',
    mergeFields: ['studentName', 'subject', 'score', 'grade'],
  },
  REPORT_READY: {
    type: 'REPORT_READY',
    titleEn: 'Report Ready for Download',
    titleTw: 'Nsa Ne Wɔwɔ Mu',
    bodyEn: '{studentName}\'s {term} report card is now available for download. Click to view.',
    bodyTw: '{studentName} {term} wɔwɔ mu. Klik kɔkɔɔ.',
    mergeFields: ['studentName', 'term'],
  },
  ANNOUNCEMENT: {
    type: 'ANNOUNCEMENT',
    titleEn: 'New Announcement',
    titleTw: 'Kasafo Kawan',
    bodyEn: 'New announcement: "{subject}". Read more in the portal.',
    bodyTw: 'Kasafo kawan: "{subject}". Kæ kɔ portal.',
    mergeFields: ['subject'],
  },
  MESSAGE: {
    type: 'MESSAGE',
    titleEn: 'New Message',
    titleTw: 'Nsɛm Kawan',
    bodyEn: 'You have a new message from {sender}. Subject: "{subject}"',
    bodyTw: 'Wɔhavi nsɛm firi {sender}. "{subject}"',
    mergeFields: ['sender', 'subject'],
  },
  TASK_ASSIGNED: {
    type: 'TASK_ASSIGNED',
    titleEn: 'Task Assigned',
    titleTw: 'Adwumayɛ Di Sɛn',
    bodyEn: 'You have been assigned a new task: "{taskName}". Due: {dueDate}',
    bodyTw: 'Wɔde adwumayɛ di sɛn: "{taskName}". {dueDate}',
    mergeFields: ['taskName', 'dueDate'],
  },
  APPROVAL_REQUEST: {
    type: 'APPROVAL_REQUEST',
    titleEn: 'Approval Required',
    titleTw: 'Sɛn Di Pɛ',
    bodyEn: 'A request requires your approval: {requestType} for {studentName}',
    bodyTw: 'Sɛn di pɛ: {requestType} {studentName}',
    mergeFields: ['requestType', 'studentName'],
  },
  SYSTEM: {
    type: 'SYSTEM',
    titleEn: 'System Update',
    titleTw: 'Sistema Kawan',
    bodyEn: '{message}',
    bodyTw: '{message}',
    mergeFields: ['message'],
  },
  INFO: {
    type: 'INFO',
    titleEn: 'Information',
    titleTw: 'Bubuama',
    bodyEn: '{message}',
    mergeFields: ['message'],
  },
  WARNING: {
    type: 'WARNING',
    titleEn: 'Warning',
    titleTw: 'Adwene Bawase',
    bodyEn: '{message}',
    mergeFields: ['message'],
  },
  ERROR: {
    type: 'ERROR',
    titleEn: 'Error',
    titleTw: 'Kɔbɔbɔɔ',
    bodyEn: '{message}',
    mergeFields: ['message'],
  },
  SUCCESS: {
    type: 'SUCCESS',
    titleEn: 'Success',
    titleTw: 'Hofi Yie',
    bodyEn: '{message}',
    mergeFields: ['message'],
  },
}

// --- Bulk Notification ---

export interface BulkNotificationInput {
  userIds: string[]
  type: NotificationType
  title: string
  body: string
  data?: Record<string, unknown>
  sendEmail?: boolean
  sendPush?: boolean
}

export async function sendBulkNotifications(input: BulkNotificationInput): Promise<void> {
  const users = await prisma.user.findMany({
    where: {
      id: { in: input.userIds },
      isActive: true,
    },
    include: { student: true, staff: true },
  })

  for (const user of users) {
    // Create in-app notification
    await createNotification({
      userId: user.id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column
      type: input.type as any,
      title: input.title,
      body: input.body,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column
      data: input.data as any,
    })

    // Send email if opted in and email available
    if (input.sendEmail && user.email) {
      await sendEmail({
        to: user.email,
        subject: input.title,
        html: `<p>${input.body}</p><p><a href="https://portal.novastarmontissorischool.com">View in Portal</a></p>`,
        tags: [{ name: 'notification-type', value: input.type }],
      })
    }
  }
}

// --- Merge Field Replacement ---

export function fillTemplate(template: string, fields: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(fields)) {
    result = result.replace(new RegExp(`{${key}}`, 'g'), value)
  }
  return result
}

export type { NotificationType }
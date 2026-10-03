// ============================================================================
// Notifications System — Email, Push, In-App
// ============================================================================

import { Resend } from 'resend'
import { prisma } from '@novastar/database'
import type { NotificationType } from '@novastar/shared-types'

/**
 * Why an email did not go out, as a closed set.
 *
 * A caller has to be able to tell "this deployment cannot send email at all"
 * apart from "the provider refused this message", because the two have different
 * fixes and only the first is a configuration problem.
 */
export type EmailFailureReason = 'not-configured' | 'provider-rejected'

/**
 * A send that did not happen.
 *
 * WHY THIS THROWS
 * ---------------
 * `sendEmail` used to `console.error` and return `null` for every failure. That is
 * the right shape for a courtesy notification and the wrong shape for anything a
 * person is waiting on: a verification or password-setup link that silently fails
 * to send strands the recipient with no password and no way forward, and the
 * only trace is one line in a log nobody reads. Delivery failure has to reach the
 * caller so it can be surfaced and retried.
 *
 * WHAT IS DELIBERATELY ABSENT
 * --------------------------
 * The message and the log line carry the reason, the provider's error name, its
 * message and its status code — and nothing else. `options` is never attached and
 * never logged: an auth email's body embeds a single-use token in its action URL,
 * so echoing the payload into a log would write a working credential to disk.
 */
export class EmailDeliveryError extends Error {
  readonly reason: EmailFailureReason

  constructor(reason: EmailFailureReason, detail: string) {
    super(`[email] ${detail}`)
    this.name = 'EmailDeliveryError'
    this.reason = reason
  }
}

// Lazy-initialized Resend client to avoid module-load-time API key requirement
let _resend: Resend | null = null

/**
 * The configured Resend client.
 *
 * Naming the variable is the whole point of the failure here: `RESEND_API_KEY`
 * is the single line between a working deployment and one where no verification,
 * setup or reset email can be delivered at all, and an operator seeing
 * "something went wrong" has no way to find it.
 */
function getResend(): Resend {
  if (!_resend) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey || apiKey.trim().length === 0) {
      throw new EmailDeliveryError(
        'not-configured',
        'RESEND_API_KEY is not set, so no email can be sent. Set it in .env (see .env.example). ' +
          'Without it every verification, password-setup and password-reset email is undeliverable.',
      )
    }
    _resend = new Resend(apiKey)
  }
  return _resend
}

/**
 * Reduce a provider error to the fields that are safe to log.
 *
 * A provider error object can carry the request it failed on. That request holds
 * the message body, and an auth message body holds a token, so only the scalar
 * diagnostic fields are read out — never the whole object, never the payload.
 */
function describeProviderError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error)
  const candidate = error as { name?: unknown; message?: unknown; statusCode?: unknown }
  const parts: string[] = []
  if (typeof candidate.name === 'string') parts.push(candidate.name)
  if (typeof candidate.message === 'string') parts.push(candidate.message)
  if (typeof candidate.statusCode === 'number') parts.push(`HTTP ${candidate.statusCode}`)
  return parts.length > 0 ? parts.join(': ') : 'provider returned an unrecognised error'
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

/**
 * Sends one email and resolves only when the provider accepted it.
 *
 * Rejects with `EmailDeliveryError`. Callers that genuinely are best-effort — a
 * payment receipt, a bulk announcement — must say so at the call site with their
 * own `.catch`; see `sendBulkNotifications` below. Callers delivering a
 * credential must let the rejection propagate.
 */
export async function sendEmail(options: EmailOptions): Promise<{ id: string }> {
  // Outside the try: a missing key is a configuration fault, not a provider
  // fault, and must surface as `not-configured` rather than being relabelled.
  const resend = getResend()

  let result: Awaited<ReturnType<Resend['emails']['send']>>
  try {
    result = await resend.emails.send({
      from: options.from || 'Novastar Montessori <noreply@novastarmontessori.com>',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text ?? '',
      tags: options.tags,
    })
  } catch (error) {
    const detail = describeProviderError(error)
    console.error('[email] provider threw while sending:', detail)
    throw new EmailDeliveryError('provider-rejected', `Resend request failed — ${detail}`)
  }

  if (result.error) {
    const detail = describeProviderError(result.error)
    console.error('[email] provider rejected the message:', detail)
    throw new EmailDeliveryError('provider-rejected', `Resend refused the message — ${detail}`)
  }

  // `result.data!` used to be asserted with a non-null assertion here, which turns
  // an accepted-but-empty response into a TypeError that reads like a bug in the
  // caller. It is a delivery failure, so it is reported as one.
  if (!result.data?.id) {
    throw new EmailDeliveryError(
      'provider-rejected',
      'Resend accepted the request but returned no message id, so delivery is unconfirmed.',
    )
  }

  return { id: result.data.id }
}

// --- Auth email templates ---

/**
 * Inputs shared by the three credential emails.
 *
 * `actionUrl` is the only place a token ever appears: not in the subject, not in
 * the log line, and not in any field a template can accidentally inline.
 */
export interface AuthEmailInput {
  /** Named in the greeting so the recipient can tell which of several school
   *  systems the message is about. */
  schoolName: string
  recipientName: string
  /** Absolute, single-use URL. Never logged. */
  actionUrl: string
  /** Lifetime of the link, in hours, so the copy can state the real deadline
   *  rather than a vague "shortly". */
  expiresInHours: number
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/**
 * Escape interpolated values for the HTML part.
 *
 * `schoolName` and `recipientName` are operator- and user-supplied text going into
 * an HTML email, so an unescaped `<` would let a school name inject markup into
 * every message sent to its parents.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Shell shared by all three credential emails.
 *
 * Deliberately inline-styled: email clients strip `<style>` blocks and classes,
 * so an auth link that renders as unstyled text in Gmail is a support ticket. The
 * plain-text fallback carries the same URL, because a link that exists only in
 * the HTML part is unreachable from a client that blocks the HTML part.
 */
function authEmailShell(input: {
  heading: string
  introHtml: string
  introText: string
  ctaLabel: string
  actionUrl: string
  schoolName: string
  noteHtml: string
  noteText: string
  expiresInHours: number
}): RenderedEmail {
  const { heading, introHtml, introText, ctaLabel, actionUrl, schoolName, noteHtml, noteText } = input
  const deadline = `This link expires in ${input.expiresInHours} hour${input.expiresInHours === 1 ? '' : 's'}.`
  return {
    subject: `${heading} — ${schoolName}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1f2937;max-width:560px">
  <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>
  ${introHtml}
  <p style="margin:24px 0">
    <a href="${escapeHtml(actionUrl)}" style="background:#1f2937;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(ctaLabel)}</a>
  </p>
  <p style="margin:24px 0 8px;font-size:14px;color:#4b5563">${escapeHtml(noteHtml)} ${escapeHtml(deadline)}</p>
  <p style="margin:0 0 8px;font-size:14px;color:#4b5563">If the button does not work, copy this address into your browser:</p>
  <p style="margin:0 0 24px;font-size:14px;word-break:break-all"><a href="${escapeHtml(actionUrl)}">${escapeHtml(actionUrl)}</a></p>
  <p style="margin:0;font-size:12px;color:#6b7280">${escapeHtml(schoolName)} School Management System</p>
</div>`,
    text: `${heading}

${introText}

${ctaLabel}: ${actionUrl}

${noteText} ${deadline}

If the button does not work, copy this address into your browser:
${actionUrl}

${schoolName} School Management System`,
  }
}

/** Confirming that the address a person was invited with is one they control. */
export function verifyEmailTemplate(input: AuthEmailInput): RenderedEmail {
  const greeting = `Hello ${input.recipientName},`
  return authEmailShell({
    heading: 'Verify your email address',
    introHtml: `<p style="margin:0 0 12px">${escapeHtml(greeting)}</p><p style="margin:0 0 12px">An account was created for you at ${escapeHtml(input.schoolName)}. Confirm this address to activate it.</p>`,
    introText: `${greeting}\n\nAn account was created for you at ${input.schoolName}. Confirm this address to activate it.`,
    ctaLabel: 'Verify my email address',
    actionUrl: input.actionUrl,
    schoolName: input.schoolName,
    noteHtml: 'If you did not expect this message, you can ignore it — nothing is activated until you follow the link.',
    noteText: 'If you did not expect this message, you can ignore it — nothing is activated until you follow the link.',
    expiresInHours: input.expiresInHours,
  })
}

/**
 * The agreed onboarding design: a person is invited and sets their own password.
 * No password is ever emailed, so there is nothing here to leak from a mailbox
 * or a forwarding rule, and nothing for the recipient to rotate later.
 */
export function setPasswordTemplate(input: AuthEmailInput): RenderedEmail {
  const greeting = `Hello ${input.recipientName},`
  return authEmailShell({
    heading: 'Set your Novastar password',
    introHtml: `<p style="margin:0 0 12px">${escapeHtml(greeting)}</p><p style="margin:0 0 12px">An account has been created for you at ${escapeHtml(input.schoolName)}. Follow the link to choose your own password and sign in. We never send passwords by email.</p>`,
    introText: `${greeting}\n\nAn account has been created for you at ${input.schoolName}. Follow the link to choose your own password and sign in. We never send passwords by email.`,
    ctaLabel: 'Set my password',
    actionUrl: input.actionUrl,
    schoolName: input.schoolName,
    noteHtml: 'Set a password of at least 12 characters. If you did not expect this invitation, ignore this message.',
    noteText: 'Set a password of at least 12 characters. If you did not expect this invitation, ignore this message.',
    expiresInHours: input.expiresInHours,
  })
}

/**
 * A reset link proves control of a mailbox, not knowledge of the old password,
 * so it deliberately grants no access on its own: following the link only lets
 * the holder choose a new one.
 */
export function passwordResetTemplate(input: AuthEmailInput): RenderedEmail {
  const greeting = `Hello ${input.recipientName},`
  return authEmailShell({
    heading: 'Reset your Novastar password',
    introHtml: `<p style="margin:0 0 12px">${escapeHtml(greeting)}</p><p style="margin:0 0 12px">A password reset was requested for your ${escapeHtml(input.schoolName)} account. Follow the link to choose a new password.</p>`,
    introText: `${greeting}\n\nA password reset was requested for your ${input.schoolName} account. Follow the link to choose a new password.`,
    ctaLabel: 'Choose a new password',
    actionUrl: input.actionUrl,
    schoolName: input.schoolName,
    noteHtml: 'If you did not request this, no action is needed — your password has not changed and this link does nothing on its own.',
    noteText: 'If you did not request this, no action is needed — your password has not changed and this link does nothing on its own.',
    expiresInHours: input.expiresInHours,
  })
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

    // Send email if opted in and email available.
    //
    // Best-effort, and deliberately caught here rather than left to propagate: this
    // is a bulk fan-out whose in-app notification has already been recorded, so an
    // unreachable mailbox for one recipient must not abort the remaining
    // recipients. Every other `sendEmail` caller — anything delivering a
    // credential — lets the rejection through.
    if (input.sendEmail && user.email) {
      await sendEmail({
        to: user.email,
        subject: input.title,
        html: `<p>${input.body}</p><p><a href="https://portal.novastarmontissorischool.com">View in Portal</a></p>`,
        tags: [{ name: 'notification-type', value: input.type }],
      }).catch((error) => {
        console.error('[email] bulk notification to a recipient was not delivered:', error)
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
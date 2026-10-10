/**
 * API endpoint to verify a TOTP code and activate 2FA for the *caller*.
 *
 * After successful verification, the user's `twoFactorEnabled` is set to true
 * and the secret remains encrypted in `twoFactorSecret` for future code verification.
 *
 * The subject is the authenticated session's user, always. This route used to
 * read `userId` from the request body and set `twoFactorEnabled: true` on it,
 * which let an unauthenticated caller both enable a second factor on an account
 * they did not control and use the stored secret to satisfy it. A `userId` in
 * the body is now ignored.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { verifyTOTP } from '@/lib/auth/totp'
import { decrypt } from '@/lib/security/encryption'

export async function POST(req: Request) {
  try {
    const { userId, tenantId } = await getCachedSessionAndTenant()

    const body = await req.json()
    const { code } = body

    if (!code) {
      return new NextResponse('Missing code', { status: 400 })
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { twoFactorSecret: true, settings: true },
    })

    if (!user) {
      return new NextResponse('User not found', { status: 404 })
    }

    if (!user.twoFactorSecret) {
      return new NextResponse('TOTP not set up. Call /api/auth/totp first.', { status: 400 })
    }

    const decryptedSecret = await decrypt(user.twoFactorSecret)

    const settings = (user.settings as Record<string, unknown> | null) ?? {}
    const lastCounter =
      typeof settings.lastTotpCounter === 'number' ? settings.lastTotpCounter : undefined

    const counter = verifyTOTP(code, decryptedSecret, 1, lastCounter)
    if (counter === false) {
      return NextResponse.json({ success: false, error: 'Invalid code' }, { status: 401 })
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        settings: { ...settings, lastTotpCounter: counter },
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return new NextResponse('Unauthorized', { status: 401 })
    }
    console.error('[TOTP_VERIFY]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}
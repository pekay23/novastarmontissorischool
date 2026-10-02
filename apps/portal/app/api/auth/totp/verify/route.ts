/**
 * API endpoint to verify a TOTP code and activate 2FA.
 *
 * After successful verification, the user's `twoFactorEnabled` is set to true
 * and the secret remains encrypted in `twoFactorSecret` for future code verification.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyTOTP } from '@/lib/auth/totp'
import { decrypt } from '@/lib/security/encryption'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userId, code } = body

    if (!userId || !code) {
      return new NextResponse('Missing userId or code', { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
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
    console.error('[TOTP_VERIFY]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}

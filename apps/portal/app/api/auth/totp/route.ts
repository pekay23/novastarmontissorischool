/**
 * API endpoint to set up TOTP 2FA for a user.
 *
 * Returns the TOTP secret (to be scanned into an authenticator app)
 * and a QR code URL. The secret is stored encrypted at rest in the
 * user's `twoFactorSecret` field and is NOT activated until verified.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateTOTPSecret } from '@/lib/auth/totp'
import { encrypt } from '@/lib/security/encryption'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const { userId } = body

    if (!userId) {
      return new NextResponse('Missing userId', { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, twoFactorSecret: true, twoFactorEnabled: true },
    })

    if (!user) {
      return new NextResponse('User not found', { status: 404 })
    }

    // Generate a new TOTP secret
    const { secret, uri } = generateTOTPSecret(user.email, 'Novastar Montessori School')

    // Store encrypted for verification step
    const encryptedSecret = await encrypt(secret)

    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorSecret: encryptedSecret,
        twoFactorEnabled: false, // Only enable after verification
      },
    })

    return NextResponse.json({ secret, uri })
  } catch (error) {
    console.error('[TOTP_SETUP]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}

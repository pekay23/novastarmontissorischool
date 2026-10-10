/**
 * API endpoint to set up TOTP 2FA for the *caller*.
 *
 * Returns the TOTP secret (to be scanned into an authenticator app)
 * and a QR code URL. The secret is stored encrypted at rest in the
 * user's `twoFactorSecret` field and is NOT activated until verified.
 *
 * The subject of enrolment is the authenticated session's user, always.
 * This route used to read `userId` from the request body and overwrite that
 * account's `twoFactorSecret` — any unauthenticated caller who knew or guessed
 * a user id could reset another person's second factor to a secret of their own
 * choosing. A `userId` in the body is now ignored.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { generateTOTPSecret } from '@/lib/auth/totp'
import { encrypt } from '@/lib/security/encryption'

export async function POST(_req: Request) {
  try {
    // `getCachedSessionAndTenant` resolves the tenant from the database and
    // refuses SUSPENDED/ARCHIVED/DELETED accounts, so neither is a subject an
    // enrolment could be attached to.
    const { userId, tenantId } = await getCachedSessionAndTenant()

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { email: true },
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
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return new NextResponse('Unauthorized', { status: 401 })
    }
    console.error('[TOTP_SETUP]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}
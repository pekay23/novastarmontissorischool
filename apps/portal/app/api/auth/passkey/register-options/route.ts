import { NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { rpConfig } from '@/lib/auth/passkey-config'

/**
 * Begins passkey registration for the *caller*.
 *
 * This route used to accept an `email` in the body and enrol against whichever
 * account matched it. Combined with `POST /api/auth/passkey/register-verify`
 * minting a `pk_` bridge token, that was an account-takeover path: knowing a
 * colleague's email address was enough to attach an authenticator you control
 * to their account. Registration now derives the subject from the authenticated
 * session, so an `email` in the body is ignored.
 */
export async function POST(_req: Request) {
  try {
    const { userId, tenantId } = await getCachedSessionAndTenant()

    // Cleanup expired challenges
    await prisma.passkeyChallenge.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })

    const user = await prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, name: true, email: true, passkeys: { select: { credentialId: true, transports: true } } },
    })

    if (!user) {
      return new NextResponse('User not found', { status: 404 })
    }

    // Check if user already has 5 passkeys (reasonable limit)
    if (user.passkeys.length >= 5) {
      return new NextResponse('Maximum number of passkeys reached', { status: 400 })
    }

    const options = await generateRegistrationOptions({
      rpName: rpConfig.rpName,
      rpID: rpConfig.rpID,
      userID: Buffer.from(user.id),
      userName: user.email,
      userDisplayName: user.name ?? user.email,
      excludeCredentials: user.passkeys.map((pk) => ({
        id: pk.credentialId,
        transports: pk.transports as AuthenticatorTransport[],
      })),
      timeout: 60000,
      attestationType: 'none',
    })

    await prisma.passkeyChallenge.create({
      data: {
        userId: user.id,
        challenge: options.challenge,
        type: 'registration',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      },
    })

    return NextResponse.json({ options, user: { id: user.id, name: user.name } })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return new NextResponse('Unauthorized', { status: 401 })
    }
    console.error('[PASSKEY_REGISTER_OPTIONS]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}

type AuthenticatorTransport = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'
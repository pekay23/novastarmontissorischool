import { NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { rpConfig } from '@/lib/auth/passkey-config'
import crypto from 'crypto'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'
import { createAuditLog, AuditLogAction } from '@/lib/audit/logger'

/**
 * Pre-authenticated by design: the WebAuthn signature is the credential. It is
 * rate limited here for the same reason as `login-options` — `proxy.ts` exempted
 * all of `/api/auth/*` from its limiter, so nothing else throttled it.
 */
const PASSKEY_ATTEMPTS = 10
const PASSKEY_WINDOW_MS = 5 * 60 * 1000

/**
 * Every `UserStatus` other than `ACTIVE` refuses a passkey login. Written as a
 * positive test against `ACTIVE` rather than a list of the three known-bad
 * values, so a status added to the enum later is refused by default instead of
 * silently admitted. `isActive` is a second, independent column and is checked
 * with it.
 */
function canPasskeyLogin(user: { status: string; isActive: boolean }): boolean {
  return user.status === 'ACTIVE' && user.isActive
}

export async function POST(req: Request) {
  const { success, reset } = checkRateLimit(
    `passkey:login-verify:${clientIdentifier(req)}`,
    PASSKEY_ATTEMPTS,
    PASSKEY_WINDOW_MS,
  )
  if (!success) {
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
    return new NextResponse(
      JSON.stringify({ error: 'Too many passkey attempts. Please try again later.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(PASSKEY_ATTEMPTS),
          'X-RateLimit-Remaining': '0',
        },
      },
    )
  }

  try {
    const body = await req.json()
    const { credential } = body

    if (!credential) {
      return new NextResponse('Missing credential', { status: 400 })
    }

    const clientDataJSON = Buffer.from(credential.response.clientDataJSON, 'base64').toString('utf8')
    const parsedClientData = JSON.parse(clientDataJSON)
    const signedChallenge = parsedClientData.challenge

    // Atomically consume the challenge
    const storedChallenge = await prisma.$transaction(async (tx) => {
      const challenge = await tx.passkeyChallenge.findUnique({
        where: { challenge: signedChallenge },
      })
      if (!challenge) return null
      await tx.passkeyChallenge.delete({ where: { id: challenge.id } })
      return challenge
    })

    if (!storedChallenge || storedChallenge.type !== 'authentication' || storedChallenge.expiresAt < new Date()) {
      return new NextResponse('Challenge expired or not found', { status: 401 })
    }

    // Find the passkey
    const passkey = await prisma.passkey.findUnique({
      where: { credentialId: credential.id },
      include: { user: { include: { tenant: { select: { isActive: true } } } } },
    })

    if (!passkey || !passkey.user) {
      return new NextResponse('Passkey not found', { status: 401 })
    }

    if (passkey.user.tenant?.isActive === false) {
      return new NextResponse('Tenant has been suspended', { status: 403 })
    }

    // Validate challenge-user binding
    if (storedChallenge.userId && storedChallenge.userId !== passkey.userId) {
      return new NextResponse('Challenge-user mismatch', { status: 401 })
    }

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: rpConfig.origin as string[],
      expectedRPID: rpConfig.rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, 'base64'),
        counter: Number(passkey.counter),
      },
      requireUserVerification: true,
    })

    if (!verification.verified || !verification.authenticationInfo) {
      return new NextResponse('Verification failed', { status: 401 })
    }

    const { newCounter } = verification.authenticationInfo

    // Refuse a suspended/archived/deleted account BEFORE any write. Mutating the
    // credential counter of an account that may not sign in would leave the
    // stored counter ahead of the authenticator's, which invalidates the
    // credential on the account's next legitimate login.
    if (!canPasskeyLogin(passkey.user)) {
      return new NextResponse('Account is not active', { status: 403 })
    }

    await prisma.passkey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(newCounter),
        lastUsedAt: new Date(),
      },
    })

    // Generate a one-time bridge token prefixed with 'pk_' for NextAuth
    const bridgeToken = 'pk_' + crypto.randomBytes(32).toString('hex')
    const bridgeExpires = new Date(Date.now() + 60 * 1000)

    await prisma.user.update({
      where: { id: passkey.user.id },
      data: {
        passkeyBridgeToken: bridgeToken,
        passkeyBridgeExpires: bridgeExpires,
      },
    })

    await createAuditLog({
      userId: passkey.user.id,
      action: AuditLogAction.PASSKEY_LOGIN,
      entity: 'users',
      entityId: passkey.user.id,
      description: `Logged in via passkey: ${passkey.name || 'Unknown'}`,
    }).catch((err) => console.error('[auth] Failed to log event:', err))

    return NextResponse.json({ success: true, token: bridgeToken })
  } catch (error) {
    console.error('[PASSKEY_LOGIN_VERIFY]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}

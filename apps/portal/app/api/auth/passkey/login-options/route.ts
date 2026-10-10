import { NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { rpConfig } from '@/lib/auth/passkey-config'
import { checkRateLimit, clientIdentifier } from '@/lib/rate-limit'

/**
 * Pre-authenticated by design: there is no session yet, and the returned options
 * are protected by the WebAuthn signature check in `login-verify`.
 *
 * It is still rate limited here rather than in `proxy.ts`, because the proxy's
 * `publicPaths` list exempted all of `/api/auth/*` from its own limiter. The
 * limits mirror the `CREDENTIALS_ATTEMPTS` pattern in
 * `app/api/auth/[...nextauth]/route.ts`: each handler limits its own credential
 * path, so a burst against passkeys cannot exhaust a client's budget for the
 * credentials callback (or vice versa).
 */
const PASSKEY_ATTEMPTS = 10
const PASSKEY_WINDOW_MS = 5 * 60 * 1000

export async function POST(req: Request) {
  const { success, reset } = checkRateLimit(
    `passkey:login-options:${clientIdentifier(req)}`,
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
    const body = await req.json().catch(() => ({}))
    const { email } = body

    let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] = []
    let userId = null

    if (email) {
      const user = await prisma.user.findFirst({
        where: { email },
        select: { id: true, passkeys: { select: { credentialId: true, transports: true } } },
      })

      if (user) {
        userId = user.id
        allowCredentials = user.passkeys.map((pk) => ({
          id: pk.credentialId,
          transports: pk.transports as AuthenticatorTransport[],
        }))
      }
    }

    // Cleanup expired challenges
    await prisma.passkeyChallenge.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })

    // Allow discoverable credentials if no email or user not found
    const options = await generateAuthenticationOptions({
      rpID: rpConfig.rpID,
      allowCredentials,
      userVerification: 'preferred',
    })

    await prisma.passkeyChallenge.create({
      data: {
        userId,
        challenge: options.challenge,
        type: 'authentication',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    })

    return NextResponse.json({ options })
  } catch (error) {
    console.error('[PASSKEY_LOGIN_OPTIONS]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}

type AuthenticatorTransport = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'

import { NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { rpConfig } from '@/lib/auth/passkey-config'

export async function POST(req: Request) {
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

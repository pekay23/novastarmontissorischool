import { NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { rpConfig } from '@/lib/auth/passkey-config'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const { email } = body

    if (!email) {
      return new NextResponse('Missing email', { status: 400 })
    }

    // Cleanup expired challenges
    await prisma.passkeyChallenge.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })

    const user = await prisma.user.findFirst({
      where: { email },
      select: { id: true, name: true, passkeys: { select: { credentialId: true, transports: true } } },
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
      userName: email,
      userDisplayName: user.name ?? email,
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

    return NextResponse.json({ options, user })
  } catch (error) {
    console.error('[PASSKEY_REGISTER_OPTIONS]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}

type AuthenticatorTransport = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb'

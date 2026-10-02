import { NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { rpConfig } from '@/lib/auth/passkey-config'
import crypto from 'crypto'
import { createAuditLog, AuditLogAction } from '@/lib/audit/logger'

export async function POST(req: Request) {
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
      include: { user: true },
    })

    if (!passkey || !passkey.user) {
      return new NextResponse('Passkey not found', { status: 401 })
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

    await prisma.passkey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(newCounter),
        lastUsedAt: new Date(),
      },
    })

    if (passkey.user.status !== 'ACTIVE') {
      return new NextResponse('Account is not active', { status: 403 })
    }

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

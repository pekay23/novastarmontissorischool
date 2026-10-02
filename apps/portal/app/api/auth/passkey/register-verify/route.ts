import { NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { rpConfig } from '@/lib/auth/passkey-config'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { credential, email, name } = body

    if (!credential || !email) {
      return new NextResponse('Missing credential or email', { status: 400 })
    }

    // Extract challenge from clientDataJSON
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

    if (!storedChallenge || storedChallenge.type !== 'registration') {
      return new NextResponse('Challenge expired or not found', { status: 401 })
    }

    const user = await prisma.user.findFirst({
      where: { email },
    })

    if (!user) {
      return new NextResponse('User not found', { status: 404 })
    }

    if (storedChallenge.userId && storedChallenge.userId !== user.id) {
      return new NextResponse('Challenge-user mismatch', { status: 401 })
    }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: storedChallenge.challenge,
      expectedOrigin: rpConfig.origin as string[],
      expectedRPID: rpConfig.rpID,
    })

    if (!verification.verified || !verification.registrationInfo) {
      return new NextResponse('Verification failed', { status: 401 })
    }

    const { publicKey, counter } = verification.registrationInfo.credential
    // publicKey is a Uint8Array, counter is a number

    await prisma.passkey.create({
      data: {
        userId: user.id,
        credentialId: credential.id,
        publicKey: Buffer.from(publicKey).toString('base64'),
        counter: BigInt(counter),
        name: name ?? null,
        transports: credential.response.transports ?? [],
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[PASSKEY_REGISTER_VERIFY]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}

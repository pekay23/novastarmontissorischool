import { NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { getCachedSessionAndTenant } from '@/lib/auth/session-context'
import { rpConfig } from '@/lib/auth/passkey-config'

/**
 * Completes passkey registration for the *caller*.
 *
 * The credential is stored against the authenticated session's user, and the
 * consumed challenge must already name that same user. This route used to take
 * an `email` from the body and look the subject up by it, so an unauthenticated
 * caller who knew an address could enrol an authenticator onto that account and
 * then exchange it for a `pk_` bridge token through
 * `POST /api/auth/passkey/login-verify`. Both the `email` and the
 * subject lookup are gone.
 */
export async function POST(req: Request) {
  try {
    const { userId } = await getCachedSessionAndTenant()

    const body = await req.json()
    const { credential, name } = body

    if (!credential) {
      return new NextResponse('Missing credential', { status: 400 })
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

    // A challenge minted for somebody else must not enrol onto this session,
    // even though the signature below would verify: the authenticator is proved,
    // not the person.
    if (storedChallenge.userId && storedChallenge.userId !== userId) {
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
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(publicKey).toString('base64'),
        counter: BigInt(counter),
        name: name ?? null,
        transports: credential.response.transports ?? [],
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.name === 'UnauthorizedError') {
      return new NextResponse('Unauthorized', { status: 401 })
    }
    console.error('[PASSKEY_REGISTER_VERIFY]', error)
    return new NextResponse('Internal Error', { status: 500 })
  }
}
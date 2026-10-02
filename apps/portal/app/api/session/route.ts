import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { logError } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    if (!token?.id) {
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: token.id as string },
      include: { role: true },
    })

    if (!user || !user.isActive) {
      return NextResponse.json({ authenticated: false }, { status: 401 })
    }

    return NextResponse.json({
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role?.name,
        schoolId: user.schoolId,
      },
    })
  } catch (error) {
    logError('Session', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


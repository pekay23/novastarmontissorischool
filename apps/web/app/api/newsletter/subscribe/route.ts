import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, name, source } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Check if already subscribed
    const existing = await prisma.newsletterSubscription.findUnique({
      where: { email: normalizedEmail }
    })

    if (existing) {
      if (existing.isActive) {
        return NextResponse.json(
          { error: 'This email is already subscribed' },
          { status: 409 }
        )
      }
      // Reactivate if previously unsubscribed
      await prisma.newsletterSubscription.update({
        where: { email: normalizedEmail },
        data: {
          isActive: true,
          name: name?.trim() || existing.name,
          source: source || existing.source,
          unsubscribedAt: null,
        }
      })
      return NextResponse.json({ message: 'Subscription reactivated' })
    }

    // Create new subscription
    await prisma.newsletterSubscription.create({
      data: {
        email: normalizedEmail,
        name: name?.trim() || null,
        source: source || 'website',
      }
    })

    return NextResponse.json({ message: 'Successfully subscribed' })
  } catch (error) {
    console.error('Newsletter subscription error:', error)
    return NextResponse.json(
      { error: 'Failed to subscribe. Please try again.' },
      { status: 500 }
    )
  }
}
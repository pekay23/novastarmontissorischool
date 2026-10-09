'use client'

import { useState } from 'react'
import { cn } from '@novastar/shared-ui'

export function NewsletterForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!email || status === 'submitting') return

    setStatus('submitting')
    try {
      // In a real implementation, this would call an API endpoint
      await new Promise((resolve) => setTimeout(resolve, 1000))
      setStatus('success')
      setEmail('')
    } catch {
      setStatus('error')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm items-center space-x-2">
      <label htmlFor="newsletter-email" className="sr-only">
        Email address
      </label>
      <input
        id="newsletter-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email address"
        disabled={status === 'submitting' || status === 'success'}
        className={cn(
          'flex h-10 w-full rounded-md border bg-white/5 px-3 py-2 text-sm text-tint-warm placeholder:text-tint-warm/50',
          'focus:outline-none focus:ring-1 focus:ring-accent-warm focus:border-accent-warm',
          status === 'error' && 'border-red-500 focus:ring-red-500',
          (status === 'submitting' || status === 'success') && 'opacity-50 cursor-not-allowed'
        )}
        aria-describedby={status === 'success' ? 'newsletter-success' : status === 'error' ? 'newsletter-error' : undefined}
      />
      <button
        type="submit"
        disabled={status === 'submitting' || status === 'success' || !email}
        className={cn(
          'inline-flex h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-primary-dark transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-accent-warm focus:ring-offset-2 focus:ring-offset-primary-dark',
          status === 'submitting' || status === 'success' || !email
            ? 'bg-accent-warm/50 cursor-not-allowed'
            : 'bg-accent-warm hover:bg-accent-warm-light'
        )}
        aria-busy={status === 'submitting'}
      >
        {status === 'submitting' ? (
          <>
            <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Subscribing...
          </>
        ) : status === 'success' ? (
          <>
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Subscribed!
          </>
        ) : (
          'Subscribe'
        )}
      </button>
      {status === 'success' && (
        <p id="newsletter-success" className="sr-only" aria-live="polite">
          Successfully subscribed to newsletter
        </p>
      )}
      {status === 'error' && (
        <p id="newsletter-error" className="sr-only" aria-live="assertive">
          Failed to subscribe. Please try again.
        </p>
      )}
    </form>
  )
}
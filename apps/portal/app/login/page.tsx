'use client'

import { Suspense } from 'react'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Input } from '@novastar/shared-ui'

export const dynamic = 'force-dynamic'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard'
  const returnTo = searchParams.get('returnTo') || callbackUrl

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [schoolCode, setSchoolCode] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showTotp, setShowTotp] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setIsLoading(true)
    setError('')

    try {
      const result = await signIn('credentials', {
        redirect: false,
        email,
        password,
        schoolCode,
        totpCode: showTotp ? totpCode : undefined,
        callbackUrl: returnTo,
      })

      if (result?.error) {
        const errMsg = result.error
        // The server throws '2FA_REQUIRED' to signal a second factor step
        if (errMsg === '2FA_REQUIRED') {
          setShowTotp(true)
          setError('')
        } else if (errMsg === 'Account is temporarily locked. Please try again later.') {
          setError(errMsg)
        } else {
          setError('Invalid credentials. Check your email, password and school code.')
        }
      } else {
        router.push(result?.url || callbackUrl)
      }
    } catch (_err) {
      setError('Login failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handlePasskeyLogin = async () => {
    setIsLoading(true)
    setError('')

    try {
      // Step 1: Get authentication options
      const res = await fetch('/api/auth/passkey/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!res.ok) {
        throw new Error(`Failed: ${res.statusText}`)
      }

      const { options } = await res.json()

      // Convert for WebAuthn
      const challenge = Uint8Array.from(
        atob(options.challenge.replace(/_/g, '/').replace(/-/g, '+')),
        (c) => c.charCodeAt(0)
      )

      const assertion = await navigator.credentials.get({
        publicKey: {
          ...options,
          challenge,
          allowCredentials: options.allowCredentials?.map((cred: { id: string; type?: string; transports?: string[] }) => ({
            ...cred,
            id: Uint8Array.from(
              atob(cred.id.replace(/_/g, '/').replace(/-/g, '+')),
              (c) => c.charCodeAt(0)
            ),
          })) || [],
        },
      }) as PublicKeyCredential & { response: AuthenticatorAssertionResponse }

      const authResponse = {
        id: assertion.id,
        rawId: btoa(String.fromCharCode(...new Uint8Array(assertion.rawId as ArrayBuffer))),
        type: assertion.type,
        response: {
          authenticatorData: btoa(String.fromCharCode(...new Uint8Array(assertion.response.authenticatorData))),
          clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(assertion.response.clientDataJSON))),
          signature: btoa(String.fromCharCode(...new Uint8Array(assertion.response.signature))),
          userHandle: assertion.response.userHandle
            ? btoa(String.fromCharCode(...new Uint8Array(assertion.response.userHandle)))
            : undefined,
        },
      }

      // Step 2: Verify and get bridge token
      const verifyRes = await fetch('/api/auth/passkey/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: authResponse }),
      })

      if (!verifyRes.ok) {
        throw new Error(`Verification failed: ${verifyRes.statusText}`)
      }

      const { token } = await verifyRes.json()

      // Step 3: Use bridge token to sign in via NextAuth
      const result = await signIn('credentials', {
        redirect: false,
        token,
        callbackUrl: returnTo,
      })

      if (result?.error) {
        setError('Passkey login failed. Please try again.')
      } else {
        router.push(result?.url || callbackUrl)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey login failed.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="font-heading text-3xl font-bold text-primary">
            Novastar Montessori
          </h1>
          <p className="text-sm text-muted-foreground">School Management Portal</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign In to Your Account</CardTitle>
            <CardDescription>
              {showTotp
                ? 'Enter the 6-digit code from your authenticator app'
                : 'Enter your credentials to access the portal'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!showTotp && (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/*
                  Each field carries an id paired with the label's htmlFor, and a
                  name attribute. The id pairing is what lets a screen reader
                  associate the label with its control and what lets clicking the
                  label focus the field; without it the three labels announced as
                  unlabelled inputs. The name is what makes these fields
                  addressable by form name, which the E2E suite relies on.
                */}
                <div>
                  <label htmlFor="schoolCode" className="block text-sm font-medium mb-1">
                    School Code
                  </label>
                  <Input
                    id="schoolCode"
                    name="schoolCode"
                    type="text"
                    autoComplete="organization"
                    placeholder="Enter your school code"
                    value={schoolCode}
                    onChange={(e) => setSchoolCode(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium mb-1">
                    Email
                  </label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium mb-1">
                    Password
                  </label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>
            )}

            {showTotp && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="totpCode" className="block text-sm font-medium mb-1">
                    Authenticator Code
                  </label>
                  <Input
                    id="totpCode"
                    name="totpCode"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-password"
                    placeholder="000000"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    maxLength={6}
                    required
                  />
                </div>

                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button type="submit" className="flex-1" disabled={isLoading || totpCode.length !== 6}>
                    {isLoading ? 'Verifying...' : 'Verify'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowTotp(false)}>
                    Back
                  </Button>
                </div>
              </form>
            )}

            {!showTotp && (
              <>
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handlePasskeyLogin}
                  disabled={isLoading || !email}
                  type="button"
                >
                  {isLoading ? 'Authenticating...' : 'Use Passkey'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Novastar Montessori School Management System
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginContent />
    </Suspense>
  )
}

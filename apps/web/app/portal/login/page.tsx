'use client'

import { Suspense, useEffect, useState } from 'react'
import { Eye, EyeOff, Fingerprint } from 'lucide-react'
import { getProviders, signIn, type ClientSafeProvider } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Input } from '@novastar/shared-ui'
import { ssoProviderLabel, ssoRefusalMessage } from '@/lib/auth/sso'

interface SecretFieldProps {
  id: string
  name: string
  label?: string
  type: 'text' | 'password'
  value: string
  onChange: (value: string) => void
  show: boolean
  onToggleShow: () => void
  placeholder?: string
  required?: boolean
  autoComplete?: string
}

function SecretField({
  id,
  name,
  label,
  type,
  value,
  onChange,
  show,
  onToggleShow,
  placeholder,
  required = false,
  autoComplete,
}: SecretFieldProps) {
  const fieldLabel = label ?? id
  return (
    <div>
      {label && (
        <label htmlFor={id} className="block text-sm font-medium mb-1">
          {label}
        </label>
      )}
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={show ? 'text' : type}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className="pr-12"
        />
        <button
          type="button"
          tabIndex={0}
          aria-label={show ? `Hide ${fieldLabel.toLowerCase()}` : `Show ${fieldLabel.toLowerCase()}`}
          onClick={onToggleShow}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onToggleShow()
            }
          }}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md bg-background text-muted-foreground hover:text-foreground"
        >
          {show ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  )
}

export const dynamic = 'force-dynamic'

/**
 * The providers this deployment has credentials for, read from NextAuth itself.
 *
 * `getProviders()` is the one source of truth: it reports the providers
 * `authOptions.providers` actually contains, and a provider whose client id or
 * secret is absent is never registered — so it never appears here and no button
 * is rendered for it. Duplicating the list from `NEXT_PUBLIC_` variables would
 * mean two declarations of what is configured, and the one that drifts is the one
 * a visitor clicks.
 *
 * It is a fetch, so the section is empty until it resolves. That is the
 * fail-closed direction: offering a button before the answer arrives would be
 * offering one that might not work.
 */
function useConfiguredSsoProviders(): ClientSafeProvider[] {
  const [providers, setProviders] = useState<ClientSafeProvider[] | null>(null)

  useEffect(() => {
    let active = true
    getProviders()
      .then((result) => {
        if (active && result) setProviders(Object.values(result))
      })
      .catch(() => {
        // A provider list that cannot be read is a list with no buttons in it.
        // The credentials form is unaffected.
        if (active) setProviders([])
      })

    return () => {
      active = false
    }
  }, [])

  return providers ?? []
}

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/portal/dashboard'
  const returnTo = searchParams.get('returnTo') || callbackUrl

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showTotp, setShowTotp] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  const ssoProviders = useConfiguredSsoProviders()

  /**
   * Why the last single sign-in was turned down, if it was.
   *
   * Only this app's own `sso_` codes render anything. The same `error` parameter
   * carries next-auth's codes (`AccessDenied`, `CredentialsSignin`, …), and those
   * describe failures the form below already reports in its own words — a code
   * this app does not recognise gets no banner at all rather than a guess.
   *
   * The sentence comes from `lib/auth/sso.ts`, the same table the server refused
   * from, so the page never restates a rule and no free text is read out of the
   * URL.
   */
  const ssoRefusal = (() => {
    const code = searchParams.get('error')
    if (!code || !code.startsWith('sso_')) return null

    return ssoRefusalMessage(code, ssoProviderLabel(searchParams.get('provider') ?? ''))
  })()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    setIsLoading(true)
    setError('')

    try {
      const result = await signIn('credentials', {
        redirect: false,
        email,
        password,
        totpCode: showTotp ? totpCode : undefined,
        callbackUrl: returnTo,
      })

      if (result?.error) {
        const errMsg = result.error
        // The server throws '2FA_REQUIRED' to signal a second factor step.
        // Every other credential failure arrives as one generic sentence —
        // `authorize()` answers a wrong password, a locked account and an unknown
        // address identically, so that branch cannot become an existence oracle.
        if (errMsg === '2FA_REQUIRED') {
          setShowTotp(true)
          setError('')
        } else {
          setError('Invalid credentials. Check your email and password.')
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

/**
    * Start a Google or Microsoft sign-in.
    *
    * `signIn` here is a full-page navigation rather than a fetch, so it carries
    * the `callbackUrl` through to the provider and back on the top-level GET that
    * ends the flow. The school code used to be written into a short-lived cookie
    * so it could reach the server after the round trip; with a single-school
    * deployment it resolves from `DEFAULT_SCHOOL_CODE` instead, so nothing is
    * recorded here.
    */
  const handleSsoLogin = (providerId: string) => {
    setError('')
    void signIn(providerId, { callbackUrl: returnTo })
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
            {/*
              Above both forms, because a refusal arrives after a full round trip
              to a provider and the visitor lands here with the two-factor step
              reset — putting it inside either form would hide it whenever that
              form was the one being shown.
            */}
            {ssoRefusal && (
              <p role="alert" className="mb-4 text-sm text-destructive">
                {ssoRefusal}
              </p>
            )}

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
                    <div className="mb-2 flex items-center justify-between">
                      <label htmlFor="password" className="block text-sm font-medium">
                        Password
                      </label>
                      <Link
                        href="/portal/forgot-password"
                        className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
                      >
                        Forgot password?
                      </Link>
                    </div>
                    <SecretField
                      id="password"
                      name="password"
                      type="password"
                      value={password}
                      onChange={setPassword}
                      show={showPassword}
                      onToggleShow={() => setShowPassword((v) => !v)}
                      placeholder="Enter your password"
                      required
                      autoComplete="current-password"
                    />
                  </div>

                {error && (
                  <div
                    role="alert"
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                  >
                    {error}
                  </div>
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
                  <div
                    role="alert"
                    className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                  >
                    {error}
                  </div>
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
                  <span className="inline-flex items-center gap-2">
                    <Fingerprint size={16} className="block" />
                    {isLoading ? 'Authenticating...' : 'Use Passkey'}
                  </span>
                </Button>

                {/*
                  Only the providers NextAuth reports. Nothing here reads an
                  environment variable: a provider whose credentials are absent is
                  never registered, so it is never in this list and no button is
                  drawn for it.

                  The button text names the provider, which is also its accessible
                  name — the icons these buttons usually carry are decorative, and
                  an icon-only button would announce nothing.
                */}
                {ssoProviders.map((provider) => (
                  <Button
                    key={provider.id}
                    variant="outline"
                    className="w-full mt-2"
                    onClick={() => handleSsoLogin(provider.id)}
                    disabled={isLoading}
                    type="button"
                  >
                    Continue with {provider.name}
                  </Button>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Secured and powered by Powered Solutions
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

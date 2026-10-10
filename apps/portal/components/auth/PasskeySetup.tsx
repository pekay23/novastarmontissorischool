'use client'

import { useState, useEffect } from 'react'
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent } from '@novastar/shared-ui'
import { Shield, CheckCircle, XCircle, Loader2 } from 'lucide-react'

interface PasskeySetupProps {
  userEmail: string
}

export function PasskeySetup({ userEmail }: PasskeySetupProps) {
  const [step, setStep] = useState<'idle' | 'options' | 'register' | 'success'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [isSupported, setIsSupported] = useState<boolean | null>(null)

  // Pure check — does not call setState (avoids react-hooks/set-state-in-effect)
  const isPasskeySupported = (): boolean => {
    if (typeof window === 'undefined') return false
    return !!(
      window.PublicKeyCredential &&
      (window.PublicKeyCredential as { isUserVerifyingPlatformAuthenticatorAvailable?: unknown })
        .isUserVerifyingPlatformAuthenticatorAvailable
    )
  }

  useEffect(() => {
    const detect = async () => {
      setIsSupported(isPasskeySupported())
    }
    void detect()
  }, [])

  const startRegistration = async () => {
    const supported = isPasskeySupported()
    if (!supported) {
      setError('Passkeys are not supported in this browser. Try a modern browser like Chrome, Safari, or Edge.')
      return
    }

    setStep('options')
    setError(null)

    try {
      const res = await fetch('/api/auth/passkey/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail }),
      })

      if (!res.ok) {
        throw new Error(`Failed: ${res.statusText}`)
      }

      const { options } = await res.json()

      // Convert base64url challenge to Uint8Array for WebAuthn
      const challenge = Uint8Array.from(atob(options.challenge.replace(/_/g, '/').replace(/-/g, '+')), c => c.charCodeAt(0))
      options.challenge = challenge

      // Handle excludeCredentials
      if (options.excludeCredentials) {
        options.excludeCredentials = options.excludeCredentials.map((cred: { id: string; type?: string; transports?: string[] }) => ({
          ...cred,
          id: Uint8Array.from(atob(cred.id.replace(/_/g, '/').replace(/-/g, '+')), c => c.charCodeAt(0)),
        }))
      }

      setStep('register')
      const credential = await navigator.credentials.create({
        publicKey: {
          ...options,
          user: {
            id: Uint8Array.from(userEmail, c => c.charCodeAt(0)),
            name: userEmail,
            displayName: userEmail,
          },
        },
      }) as PublicKeyCredential & { response: AuthenticatorAttestationResponse }

      // Convert credential to JSON-compatible format
      const response = credential.response
      const attestationResponse = {
        id: credential.id,
        rawId: btoa(String.fromCharCode(...new Uint8Array(credential.rawId as ArrayBuffer))),
        type: credential.type,
        response: {
          attestationObject: btoa(String.fromCharCode(...new Uint8Array(response.attestationObject))),
          clientDataJSON: btoa(String.fromCharCode(...new Uint8Array(response.clientDataJSON))),
          transports: response.getTransports ? response.getTransports() : [],
        },
      }

      // Verify with server
      const verifyRes = await fetch('/api/auth/passkey/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: attestationResponse, email: userEmail, name: userEmail }),
      })

      if (!verifyRes.ok) {
        throw new Error(`Verification failed: ${verifyRes.statusText}`)
      }

      setStep('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during passkey registration.')
      setStep('idle')
    }
  }

  if (step === 'success') {
    return (
      <div className="text-center py-6">
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold">Passkey registered!</h3>
        <p className="text-sm text-muted-foreground mt-2">
          You can now sign in using your passkey.
        </p>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Passkey Authentication
        </CardTitle>
        <CardDescription>
          Register a passkey for passwordless login using biometrics or security keys.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md flex items-start gap-2">
            <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === 'options' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Preparing passkey registration...</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {isSupported === true ? 'Supported' : isSupported === false ? 'Not supported' : ''}
          </div>
          <Button onClick={startRegistration} disabled={step === 'options'} variant="outline">
            {step === 'options' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Registering...
              </>
            ) : 'Register Passkey'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

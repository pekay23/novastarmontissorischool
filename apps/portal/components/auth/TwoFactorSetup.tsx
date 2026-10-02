'use client'

import { useState, useEffect } from 'react'
import { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, Input } from '@novastar/shared-ui'
import { Shield, CheckCircle, XCircle, Loader2, QrCode } from 'lucide-react'

interface TwoFactorSetupProps {
  userId: string
}

export function TwoFactorSetup({ userId }: TwoFactorSetupProps) {
  const [status, setStatus] = useState<'unknown' | 'enabled' | 'disabled'>('unknown')
  const [step, setStep] = useState<'idle' | 'qr' | 'verify' | 'success'>('idle')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const res = await fetch(`/api/users/${userId}/security`)
        const data = await res.json()
        if (data.twoFactorEnabled) {
          setStatus('enabled')
        } else {
          setStatus('disabled')
        }
      } catch {
        setStatus('unknown')
      }
    }
    loadStatus()
  }, [userId])

  async function startSetup() {
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })

      if (!res.ok) {
        throw new Error(`Failed: ${res.statusText}`)
      }

      const { secret, uri } = await res.json()
      setSecret(secret)
      setQrCode(uri) // The QR code URL contains the TOTP secret
      setStep('qr')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set up 2FA.')
    } finally {
      setIsLoading(false)
    }
  }

  async function verifyCode() {
    if (!code || code.length !== 6) {
      setError('Please enter a valid 6-digit code.')
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, code }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Invalid verification code.')
      }

      const { success } = await res.json()
      if (success) {
        setStatus('enabled')
        setStep('success')
        setCode('')
        setSecret(null)
        setQrCode(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.')
    } finally {
      setIsLoading(false)
    }
  }

  if (step === 'success') {
    return (
      <div className="text-center py-6">
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold">Two-Factor Authentication Enabled!</h3>
        <p className="text-sm text-muted-foreground mt-2">
          Your authenticator app is now verifying your identity on login.
        </p>
      </div>
    )
  }

  if (status === 'enabled' && step === 'idle') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Two-Factor Authentication</CardTitle>
          <CardDescription>
            TOTP-based 2FA is currently enabled on your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-green-600">
            <Shield className="h-4 w-4" />
            <span className="text-sm">Active</span>
          </div>
          <Button variant="outline" size="sm" className="mt-4">
            Disable 2FA
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Two-Factor Authentication
        </CardTitle>
        <CardDescription>
          Add an extra layer of security with TOTP 2FA. Scan the QR code
          with an authenticator app (Google Authenticator, Authy, etc.)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md flex items-start gap-2">
            <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === 'qr' && qrCode && (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="bg-white p-4 rounded-lg">
                <QrCode className="h-48 w-48" />
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                Scan this QR code with your authenticator app, or enter this code manually:
              </p>
              <code className="text-xs bg-muted p-2 rounded break-all block">
                {secret}
              </code>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                6-digit verification code
              </label>
              <Input
                type="text"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoComplete="one-time-password"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={verifyCode} disabled={isLoading || code.length !== 6} className="flex-1">
                {isLoading ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Verifying...</>
                ) : 'Verify & Enable'}
              </Button>
              <Button variant="outline" onClick={() => setStep('idle')} disabled={isLoading}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {step === 'idle' && (
          <Button onClick={startSetup} disabled={isLoading}>
            {isLoading ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />Setting up...</>
            ) : 'Enable Two-Factor Authentication'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

'use client'

import { Suspense } from 'react'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@novastar/shared-ui'

export const dynamic = 'force-dynamic'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [schoolCode, setSchoolCode] = useState('')
  const [isLoading, setIsLoading] = useState(false)
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
        // The server falls back to DEFAULT_SCHOOL_CODE when this is empty
        // (see resolveSchool in lib/auth.ts), so a single-school deployment
        // can sign in without the code. Previously this form returned early
        // and refused to submit when the field was blank, which made the
        // fallback unreachable from the UI and blocked anyone who did not
        // know the internal code. surface the error instead of swallowing it.
        schoolCode,
        callbackUrl,
      })

      if (result?.error) {
        setError('Invalid credentials. Check your email, password and school code.')
      } else {
        router.push(result?.url || callbackUrl)
      }
    } catch (_err) {
      setError('Login failed. Please try again.')
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
          </CardHeader>
          <CardContent>
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

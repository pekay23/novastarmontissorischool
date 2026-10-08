import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@novastar/shared-ui'
import { adminAuthConfigured } from '@/lib/admin-auth'
import { getOperatorOrNull } from '@/lib/admin-context'
import { LoginForm } from '@/components/login-form'
import { redirect } from 'next/navigation'

/**
 * `/login` — the only page in this app that renders without a session.
 *
 * An operator who already holds one is sent on rather than shown the form, decided
 * by `getOperatorOrNull`: the same `requireOperator` every other page goes through,
 * wrapped so the redirect signal is not swallowed along with the 401.
 *
 * Supports `callbackUrl` and `returnTo` search params to redirect after login.
 */
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Operator sign-in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; returnTo?: string }>
}) {
  const existing = await getOperatorOrNull()
  if (existing) {
    const { returnTo } = await searchParams
    // No basePath in merged app — redirect target is absolute
    const target = returnTo ?? '/admin/tenants'
    redirect(target)
  }

  const { callbackUrl, returnTo } = await searchParams
  const configured = adminAuthConfigured()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Platform console</CardTitle>
        <CardDescription>
          Cross-tenant administration. Sign-in is limited to accounts created with the
          tenant CLI; a school account cannot reach this console.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm configured={configured} callbackUrl={callbackUrl} returnTo={returnTo} />
      </CardContent>
    </Card>
  )
}

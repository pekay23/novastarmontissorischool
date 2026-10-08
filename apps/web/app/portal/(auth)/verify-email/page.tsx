import { VerifyEmailPanel } from './verify-email-panel'

/**
 * Server component so the page itself stays free of the token. The token is a
 * credential, and passing it through a server component keeps it out of any
 * module that is not the panel that consumes it.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token } = await searchParams
  const raw = Array.isArray(token) ? token[0] : token

  return <VerifyEmailPanel token={raw ?? null} />
}

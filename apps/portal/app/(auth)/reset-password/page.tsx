import { ResetPasswordForm } from './reset-password-form'

/** Thin server wrapper; the form is the only interactive part. */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token } = await searchParams
  const raw = Array.isArray(token) ? token[0] : token

  return <ResetPasswordForm token={raw ?? null} />
}

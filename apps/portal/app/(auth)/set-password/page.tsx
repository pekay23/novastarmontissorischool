import { SetPasswordForm } from './set-password-form'

/** Thin server wrapper: the interactive half lives in `set-password-form.tsx`. */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token } = await searchParams
  const raw = Array.isArray(token) ? token[0] : token

  return <SetPasswordForm token={raw ?? null} />
}

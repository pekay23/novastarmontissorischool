/**
 * Chrome shared by every unauthenticated portal page.
 *
 * These pages are reached by people who are not signed in — by following a link
 * out of an email, or by needing to recover an account — so none of them may
 * depend on a session. The layout is a server component and reads no session for
 * exactly that reason.
 *
 * The markup mirrors `app/login/page.tsx` (same max width, same type scale, same
 * Tailwind tokens) so moving between the sign-in page and a recovery page does
 * not look like a different application.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="font-heading text-3xl font-bold text-primary">
            Novastar Montessori
          </h1>
          <p className="text-sm text-muted-foreground">School Management Portal</p>
        </div>

        {children}

        <p className="text-center text-xs text-muted-foreground mt-4">
          Novastar Montessori School Management System
        </p>
      </div>
    </div>
  )
}

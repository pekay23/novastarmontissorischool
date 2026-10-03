import Link from 'next/link'

export default function TeacherWorkspaceNotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md text-center">
        <p className="mb-2 text-xs font-black tracking-widest text-primary uppercase">404 · My Workspace</p>
        <h2 className="mb-2 text-2xl font-black text-foreground">Page not found</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          The teacher workspace you tried to access does not exist.
        </p>
        <Link
          href="/teachers"
          className="inline-block bg-primary px-6 py-3 text-xs font-bold uppercase text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          Back to Teachers
        </Link>
      </div>
    </div>
  )
}

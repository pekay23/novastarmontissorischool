import { Skeleton } from '@novastar/shared-ui'

export default function GradesLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-16" />
        <Skeleton className="mt-2 h-4 w-56" />
      </div>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-12 w-full" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

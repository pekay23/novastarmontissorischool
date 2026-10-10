import { Skeleton } from '@novastar/shared-ui'

export default function SystemErrorsLoading() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex gap-4">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-9 w-48" />
      </div>
      <Skeleton className="h-[400px] w-full" />
    </div>
  )
}

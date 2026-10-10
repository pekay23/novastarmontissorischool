import { Skeleton } from '@novastar/shared-ui'

export default function AttendanceTakersLoading() {
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-[400px] w-full" />
    </div>
  )
}

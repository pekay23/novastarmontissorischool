import { Skeleton } from '@novastar/shared-ui'

export default function TeacherWorkspaceLoading() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

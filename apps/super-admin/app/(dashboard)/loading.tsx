import { Skeleton } from '@novastar/shared-ui'

/**
 * The skeleton for every page under this group.
 *
 * Deliberately generic rather than shaped per page: a skeleton that mirrors a
 * layout a page has not chosen yet is a skeleton that has to be kept in step with
 * the layout, and this group has pages with three different shapes.
 */
export default function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

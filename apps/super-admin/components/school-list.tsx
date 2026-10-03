import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@novastar/shared-ui'
import type { SchoolSummary } from '@/types/admin'

/**
 * One tenant's schools.
 *
 * Contact details are shown: an operator onboarding a school needs the address and
 * phone it was given. That is the whole job of this page, and it is scoped to a
 * tenant the operator has already drilled into — the roster deliberately does not
 * carry these columns.
 */
export function SchoolList({ schools }: { schools: readonly SchoolSummary[] }) {
  if (schools.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        This tenant has no schools.
      </p>
    )
  }

  return (
    <Table>
      <TableCaption>
        {schools.length} {schools.length === 1 ? 'school' : 'schools'} in this tenant.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>School</TableHead>
          <TableHead>Code</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Phone</TableHead>
          <TableHead>Address</TableHead>
          <TableHead>Established</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {schools.map((school) => (
          <TableRow key={school.id}>
            <TableCell className="font-medium">{school.name}</TableCell>
            <TableCell className="font-mono text-xs">{school.code}</TableCell>
            <TableCell className="text-xs">
              <a className="hover:underline" href={`mailto:${school.email}`}>
                {school.email}
              </a>
            </TableCell>
            <TableCell className="text-xs tabular-nums">{school.phone}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{school.address}</TableCell>
            <TableCell className="text-xs tabular-nums">
              {school.established.slice(0, 10)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

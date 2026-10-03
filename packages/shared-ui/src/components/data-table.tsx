'use client'

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'

export type { ColumnDef, VisibilityState, SortingState } from '@tanstack/react-table'

interface DataTabledProps<TData> {
  columns: ColumnDef<TData>[]
  data: TData[]
}

export function DataTabled<TData>({ columns, data }: DataTabledProps<TData>) {
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table useReactTable is a known library, disable false positive
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="rounded-md border">
      <table className="w-full">
        {/* Without this the table renders rows only and every ColumnDef.header is
            discarded — column labels silently never appear. */}
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b">
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="p-2 text-left font-medium">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                data-state={row.getIsSelected() && 'selected'}
                className="border-b"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="p-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="h-24 text-center">
                No results.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

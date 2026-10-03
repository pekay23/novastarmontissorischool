/**
 * Output formatting: `--json` for scripts and CI, `--table` for humans,
 * `--quiet` for cron.
 *
 * One rule that the tests pin down: in `--json` mode stdout carries exactly one
 * JSON document and nothing else. Anything informational goes to stderr, so a
 * pipeline that pipes stdout into `jq` never has to strip chatter first.
 */
export type OutputFormat = 'json' | 'table'

export interface OutputOptions {
  json?: boolean
  table?: boolean
  quiet?: boolean
}

export interface Writable {
  write(chunk: string): unknown
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Fixed-width columns, one row per record. */
export function formatTable(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '(none)'
  const keys = columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const widths = keys.map((key) =>
    Math.max(key.length, ...rows.map((row) => stringify(row[key]).length)),
  )
  const line = (cells: string[]) =>
    cells.map((cell, index) => (index === cells.length - 1 ? cell : cell.padEnd(widths[index]!))).join('  ')
  return [line(keys), line(widths.map((w) => '-'.repeat(w))), ...rows.map((row) => line(keys.map((k) => stringify(row[k]))))].join(
    '\n',
  )
}

/** One field per line, for single-object results such as `status`. */
export function formatRecord(record: Record<string, unknown>): string {
  const keys = Object.keys(record)
  if (keys.length === 0) return '(empty)'
  const width = Math.max(...keys.map((k) => k.length))
  return keys.map((key) => `${key.padEnd(width)}  ${stringify(record[key])}`).join('\n')
}

export class Output {
  readonly format: OutputFormat
  readonly quiet: boolean
  private payload: unknown = undefined

  constructor(
    options: OutputOptions = {},
    private readonly stdout: Writable = process.stdout,
    private readonly stderr: Writable = process.stderr,
  ) {
    if (options.json && options.table) {
      throw new Error('--json and --table are mutually exclusive')
    }
    this.format = options.json ? 'json' : 'table'
    this.quiet = options.quiet ?? false
  }

  /** The command's result. Buffered in json mode, printed at once in table mode. */
  data(value: unknown): void {
    if (this.format === 'json') {
      this.payload = value
      return
    }
    if (value === undefined || value === null) return
    if (Array.isArray(value)) {
      this.stdout.write(formatTable(value as Record<string, unknown>[]) + '\n')
      return
    }
    if (typeof value === 'object' && !(value instanceof Date)) {
      this.stdout.write(formatRecord(value as Record<string, unknown>) + '\n')
      return
    }
    this.stdout.write(stringify(value) + '\n')
  }

  /** Always stdout, no suppression. For --help, which must always print. */
  raw(text: string): void {
    this.stdout.write(text)
  }

  /** Informational. Suppressed by --quiet, and never written in json mode. */
  note(message: string): void {
    if (this.quiet || this.format === 'json') return
    this.stdout.write(message + '\n')
  }

  /** Always stderr: a warning is not suppressed by --quiet. */
  warn(message: string): void {
    this.stderr.write(message + '\n')
  }

  error(message: string): void {
    this.stderr.write(message + '\n')
  }

  /** Writes the buffered json document. No-op in table mode. */
  finish(): void {
    if (this.format !== 'json') return
    this.stdout.write(JSON.stringify(this.payload ?? null, null, 2) + '\n')
  }
}
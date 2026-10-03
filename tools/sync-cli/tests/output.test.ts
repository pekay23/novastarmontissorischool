import { describe, expect, test } from 'bun:test'
import { Output, formatRecord, formatTable } from '../output'

function sink() {
  const chunks: string[] = []
  return {
    text: () => chunks.join(''),
    write(chunk: string) {
      chunks.push(chunk)
      return true
    },
  }
}

describe('formatTable', () => {
  test('pads columns to a common width', () => {
    const output = formatTable([
      { id: 'a', table: 'students' },
      { id: 'bbbbbbbbbb', table: 'staff' },
    ])
    const lines = output.split('\n')
    expect(lines[0]).toBe('id          table')
    expect(lines[1]).toBe('----------  --------')
    expect(lines[2]).toBe('a           students')
    expect(lines[3]).toBe('bbbbbbbbbb  staff')
  })

  test('renders nothing as an explicit marker', () => {
    expect(formatTable([])).toBe('(none)')
  })

  test('formats dates, nulls and nested objects', () => {
    const output = formatTable([
      { at: new Date('2026-01-02T03:04:05.000Z'), nothing: null, payload: { a: 1 } },
    ])
    expect(output).toContain('2026-01-02T03:04:05.000Z')
    expect(output).toContain('{"a":1}')
  })

  test('honours an explicit column list and its order', () => {
    expect(formatTable([{ b: 2, a: 1 }], ['b']).split('\n')[0]).toBe('b')
  })
})

describe('formatRecord', () => {
  test('one field per line', () => {
    expect(formatRecord({ tenantId: 'school-a', pending: 3 })).toBe('tenantId  school-a\npending   3')
  })
})

describe('Output', () => {
  test('--json writes one document on stdout and nothing else', () => {
    const stdout = sink()
    const stderr = sink()
    const out = new Output({ json: true }, stdout, stderr)
    out.note('this should not appear')
    out.data({ tenantId: 'school-a', pending: 2 })
    out.finish()
    expect(JSON.parse(stdout.text())).toEqual({ tenantId: 'school-a', pending: 2 })
    expect(stdout.text().trim().startsWith('{')).toBe(true)
    expect(stdout.text().trim().endsWith('}')).toBe(true)
  })

  test('--quiet suppresses notes but not warnings', () => {
    const stdout = sink()
    const stderr = sink()
    const out = new Output({ quiet: true }, stdout, stderr)
    out.note('chatter')
    out.warn('something is wrong')
    out.data({ a: 1 })
    out.finish()
    expect(stdout.text()).not.toContain('chatter')
    expect(stdout.text()).toContain('a')
    expect(stderr.text()).toBe('something is wrong\n')
  })

  test('errors go to stderr in every mode', () => {
    const stdout = sink()
    const stderr = sink()
    const out = new Output({ json: true }, stdout, stderr)
    out.error('nope')
    expect(stdout.text()).toBe('')
    expect(stderr.text()).toBe('nope\n')
  })

  test('table mode renders arrays as tables and objects as records', () => {
    const stdout = sink()
    const out = new Output({ table: true }, stdout, sink())
    out.data([{ id: 'a', status: 'pending' }])
    out.data({ tenantId: 'school-a' })
    expect(stdout.text()).toContain('id  status')
    expect(stdout.text()).toContain('tenantId')
  })

  test('raw always writes, which is what --help needs', () => {
    const stdout = sink()
    const out = new Output({ json: true, quiet: true }, stdout, sink())
    out.raw('usage text')
    expect(stdout.text()).toBe('usage text')
  })

  test('rejects --json with --table rather than silently picking one', () => {
    expect(() => new Output({ json: true, table: true })).toThrow(/mutually exclusive/)
  })
})
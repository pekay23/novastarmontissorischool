'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Writes one dot-path into a tenant's settings document.
 *
 * A single key and a single value, not a textarea full of JSON. Two reasons: a
 * hand-edited JSON blob is a read-modify-write against whatever the client last
 * fetched, so two operators editing different keys of the same tenant overwrite
 * each other; and `__proto__` is a thing you can type into a textarea. The path
 * and the value are separate fields here, the path is validated server-side by
 * `isSafeSettingPath`, and the write is merged into the stored document inside the
 * transaction.
 */
export function SettingsEditor({
  tenantId,
  settings,
  canWrite,
}: {
  tenantId: string
  settings: Record<string, unknown>
  canWrite: boolean
}) {
  const router = useRouter()
  const [key, setKey] = useState('')
  const [rawValue, setRawValue] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  if (!canWrite) {
    return (
      <p className="text-xs text-muted-foreground">
        This operator can read tenant settings but not change them.
      </p>
    )
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setMessage(null)

    // Parsed here so `timezone: "Africa/Accra"` does not have to be quoted, and so
    // a malformed value is refused by the browser rather than arriving as the
    // string "abc" and being written as one.
    let value: unknown
    try {
      value = rawValue.trim().startsWith('{') || rawValue.trim().startsWith('[')
        ? JSON.parse(rawValue)
        : rawValue
    } catch {
      setPending(false)
      setMessage({ tone: 'bad', text: 'That value is not valid JSON.' })
      return
    }

    try {
      const response = await fetch(
        `/admin/api/tenants/${encodeURIComponent(tenantId)}/settings`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, value }),
        },
      )
      const parsed: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        setMessage({
          tone: 'bad',
          text:
            typeof parsed === 'object' && parsed !== null && 'error' in parsed
              ? String((parsed as { error: unknown }).error)
              : 'The change was refused.',
        })
        return
      }
      setKey('')
      setRawValue('')
      setMessage({ tone: 'ok', text: 'Saved.' })
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  const knownKeys = Object.keys(settings).sort()

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
        <input
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="timezone"
          aria-label="Setting path"
          required
          className="h-9 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <input
          value={rawValue}
          onChange={(event) => setRawValue(event.target.value)}
          placeholder="Africa/Accra"
          aria-label="Setting value"
          required
          className="h-9 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>

      {message ? (
        <p className={`text-xs ${message.tone === 'ok' ? 'text-muted-foreground' : 'text-destructive'}`}>
          {message.text}
        </p>
      ) : null}

      {knownKeys.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Currently stored: {knownKeys.join(', ')}.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          This tenant has no stored settings. Tenant-cli&rsquo;s <code className="font-mono">config set</code>{' '}
          writes the same document.
        </p>
      )}
    </form>
  )
}

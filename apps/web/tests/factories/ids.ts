const counters = new Map<string, number>()

export function nextId(prefix: string): string {
  const current = counters.get(prefix) ?? 0
  const next = current + 1
  counters.set(prefix, next)
  return `${prefix}_${next}`
}

export function resetIds(): void {
  counters.clear()
}

export function setIdCounter(prefix: string, value: number): void {
  counters.set(prefix, value)
}
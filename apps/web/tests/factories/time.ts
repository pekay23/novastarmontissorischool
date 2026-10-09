let frozenTime: Date | null = null

export function setFrozenTime(date: Date | number | string): void {
  frozenTime = date instanceof Date ? date : new Date(date)
}

export function clearFrozenTime(): void {
  frozenTime = null
}

export function now(): Date {
  return frozenTime ?? new Date()
}

export function today(): Date {
  const d = now()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export function withFrozenTime<T>(date: Date | number | string, fn: () => T): T {
  const previous = frozenTime
  setFrozenTime(date)
  try {
    return fn()
  } finally {
    frozenTime = previous
  }
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  result.setUTCMonth(result.getUTCMonth() + months)
  return result
}
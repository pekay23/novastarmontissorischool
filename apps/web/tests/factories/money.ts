const CENTS_PER_GHS = 100

export function toMinorUnits(ghs: number): number {
  return Math.round(ghs * CENTS_PER_GHS)
}

export function fromMinorUnits(cents: number): number {
  return cents / CENTS_PER_GHS
}

export function addMinorUnits(a: number, b: number): number {
  return a + b
}

export function subMinorUnits(a: number, b: number): number {
  return a - b
}

export function mulMinorUnits(cents: number, multiplier: number): number {
  return Math.round(cents * multiplier)
}

export function divMinorUnits(cents: number, divisor: number): number {
  return Math.round(cents / divisor)
}

export function formatGHS(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const ghs = Math.floor(abs / CENTS_PER_GHS)
  const pesewas = abs % CENTS_PER_GHS
  return `${sign}GH₵${ghs}.${pesewas.toString().padStart(2, '0')}`
}

export function parseGHS(value: string): number {
  const cleaned = value.replace(/[^\d.-]/g, '')
  const num = Number(cleaned)
  if (Number.isNaN(num)) {
    throw new Error(`Cannot parse GHS amount: ${value}`)
  }
  return toMinorUnits(num)
}
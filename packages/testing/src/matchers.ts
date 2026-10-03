export function toBeWithinRange(received: number, min: number, max: number) {
  const pass = received >= min && received <= max
  return {
    pass,
    message: () =>
      pass
        ? `expected ${received} not to be within range ${min} - ${max}`
        : `expected ${received} to be within range ${min} - ${max}`,
  }
}

export function toBeValidCuid(received: string) {
  const cuidRegex = /^c[a-z0-9]{24}$/
  const pass = cuidRegex.test(received)
  return {
    pass,
    message: () =>
      pass
        ? `expected ${received} not to be a valid CUID`
        : `expected ${received} to be a valid CUID (format: c + 24 alphanumeric)`,
  }
}

export const customMatchers = {
  toBeWithinRange,
  toBeValidCuid,
}
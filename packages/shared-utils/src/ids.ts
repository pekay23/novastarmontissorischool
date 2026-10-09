// ID Generation

export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function generateStudentId(year: number, sequence: number): string {
  const yy = String(year).slice(-2)
  const seq = String(sequence).padStart(3, '0')
  return `NOVA${yy}${seq}`
}

export function generateInvoiceNumber(year: number, sequence: number): string {
  const yy = String(year).slice(-2)
  const seq = String(sequence).padStart(4, '0')
  return `INV${yy}${seq}`
}
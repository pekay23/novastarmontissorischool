import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const TENANCY_COLORS = {
  primary: '#059669',      // emerald-600
  secondary: '#0891b3',    // teal-600
  accent: '#d97706',      // amber-600
  danger: '#dc2626',      // red-600
  warning: '#d97706',     // amber-600
  success: '#059669',     // emerald-600
  info: '#0891b3',        // teal-600
  dark: '#1e293b',        // slate-800
  light: '#f8fafc',       // slate-50
}

export const GRADE_COLORS = {
  A: '#059669',  // green
  B: '#0891b3',  // teal
  C: '#d97706',  // amber
  D: '#ea580c',  // orange
  F: '#dc2626',  // red
  Exemplary: '#059669',
  Proficient: '#0891b3',
  Developing: '#d97706',
  Emerging: '#dc2626',
}

export const ATTENDANCE_COLORS = {
  present: '#059669',
  absent: '#dc2626',
  late: '#d97706',
  excused: '#0891b3',
  'half-day': '#eab308',
}

export const SCHOOL_PHANTOM_COLORS = {
  50: '#f0fdfa',
  100: '#ccfbf1',
  200: '#99f6e4',
  300: '#5eead4',
  400: '#2dd4bf',
  500: '#14b8a6',
  600: '#059669',
  700: '#047857',
  800: '#065f46',
  900: '#0c4a1d',
  950: '#022618',
}
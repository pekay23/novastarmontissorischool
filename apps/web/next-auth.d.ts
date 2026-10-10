import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      role?: string | null
      schoolId?: string | null
      schoolName?: string | null
      tenantId?: string | null
      mustChangePassword?: boolean
    }
  }

  interface User {
    role?: string | null
    schoolId?: string | null
    schoolName?: string | null
    tenantId?: string | null
    mustChangePassword?: boolean
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    role?: string | null
    schoolId?: string | null
    schoolName?: string | null
    tenantId?: string | null
    mustChangePassword?: boolean
    issuedAt?: number
    lastChecked?: number
  }
}
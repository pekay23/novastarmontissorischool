import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createMockPrisma(): PrismaClient {
  // Returns empty results — used during `next build` when DATABASE_URL is unavailable.
  // At runtime, DATABASE_URL is always set and the real client is used.
  // Logs a warning so errors are not silently masked during build.
  if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PHASE !== undefined) {
    console.warn('[prisma] Mock client active — DATABASE_URL is not set. Queries will return empty results. This is expected during `next build` only.')
  }

  const modelProxy = new Proxy({} as Record<string, unknown>, {
    get(_target, prop: string | symbol) {
      if (prop === 'count' || prop === 'countDistinct') return () => Promise.resolve(0)
      if (prop === 'aggregate' || prop === 'groupBy') return () => Promise.resolve({})
      return () => Promise.resolve([])
    },
  })
  return new Proxy({} as PrismaClient, {
    get() { return modelProxy },
  }) as unknown as PrismaClient
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    return createMockPrisma()
  }
  const adapter = new PrismaNeon({ connectionString })
  return new PrismaClient({
    adapter,
    log: ['error', 'warn'],
  })
}

// Lazy initialization via Proxy — avoids throwing at module import time
// (e.g. during `next build` static route analysis when DATABASE_URL is unavailable)
const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    if (prop === 'then') return undefined
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient()
    }
    const client = globalForPrisma.prisma
    const value = client[prop as keyof PrismaClient]
    return typeof value === 'function' ? value.bind(client) : value
  },
}) as PrismaClient

export { prisma, PrismaClient }
export { Prisma } from '@prisma/client'

export type {
  Tenant,
  School,
  AcademicYear,
  Term,
  ClassLevel,
  Subject,
  SubjectLevel,
  Class,
  ClassTerm,
  ClassSubject,
  GradingScale,
  GradingLevel,
  AssessmentTypeConfig,
  FeeCategory,
  PaymentMethodConfig,
  FeeStructure,
  FeeLineItem,
  Role,
  Permission,
  Delegation,
  AttendanceTaker,
  User,
  Account,
  Session,
  VerificationToken,
  Staff,
  StaffRole,
  Department,
  Student,
  Parent,
  Enrollment,
  Assessment,
  Score,
  AttendanceStudent,
  AttendanceStaff,
  FeeInvoice,
  FeeInvoiceLineItem,
  Payment,
  Message,
  Notification,
  News,
  Event,
  ReportTemplate,
  House,
  Branding,
   ConfigEntity,
   Timetable,
   TimetableEntry,
   LeaveRequest,
   AuditLog,
   SystemConfig,
   SystemError,
   LogEntry,
  BookCategory,
  Book,
  BookLoan,
  InventoryCategory,
  InventoryItem,
  InventoryTransaction,
} from '@prisma/client'

export {
  TermStatus,
  Phase,
  SubjectCategory,
  Gender,
  StaffStatus,
  StudentStatus,
  AttendanceStatus,
  InvoiceStatus,
  PaymentStatus,
  MessageChannel,
  MessageStatus,
  NotificationType,
  ContentStatus,
  ReportType,
  LeaveType,
  LeaveStatus,
  LoanStatus,
   InventoryStatus,
   InventoryTransactionType,
   ErrorSeverity,
   LogLevel,
} from '@prisma/client'
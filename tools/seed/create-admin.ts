#!/usr/bin/env bun
// One-off: create admin@novastarmontessori.com with password Admin@2026
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import * as fs from 'fs'
import * as path from 'path'

const envPath = path.resolve(import.meta.dir, '../../.env')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=')
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '')
      }
    }
  }
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}

const adapter = new PrismaNeon({ connectionString })
const prisma = new PrismaClient({ adapter })

const passwordHash = await Bun.password.hash('Admin@2026', { algorithm: 'argon2id' })

const tenant = await prisma.tenant.findFirst({ where: { code: 'novastar' } })
if (!tenant) {
  console.error('Tenant "novastar" not found — run the full seed first')
  process.exit(1)
}

const school = await prisma.school.findFirst({ where: { tenantId: tenant.id, code: 'main' } })
if (!school) {
  console.error('School "main" not found — run the full seed first')
  process.exit(1)
}

const headmasterRole = await prisma.role.findFirst({
  where: { tenantId: tenant.id, schoolId: school.id, name: 'HEADMASTER' },
})

if (!headmasterRole) {
  console.error('HEADMASTER role not found — run the full seed first')
  process.exit(1)
}

const user = await prisma.user.upsert({
  where: { tenantId_email: { tenantId: tenant.id, email: 'admin@novastarmontessori.com' } },
  update: {
    passwordHash,
    roleId: headmasterRole.id,
    isActive: true,
  },
  create: {
    tenantId: tenant.id,
    schoolId: school.id,
    email: 'admin@novastarmontessori.com',
    passwordHash,
    name: 'Portal Administrator',
    roleId: headmasterRole.id,
    isActive: true,
  },
})

console.log('✅ Admin user ready:', user.email, '| active:', user.isActive, '| role: HEADMASTER')
await prisma.$disconnect()

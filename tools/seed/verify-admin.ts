#!/usr/bin/env bun
// Verify admin login credentials work end-to-end
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

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

// 1. Fetch both users
const users = await prisma.user.findMany({
  where: { tenantId: (await prisma.tenant.findFirst({ where: { code: 'novastar' } }))!.id },
  select: { email: true, name: true, isActive: true, passwordHash: true, role: { select: { name: true } } },
})

for (const u of users) {
  // 2. Verify password with Bun (same argon2id as seed)
  const pwOk = u.passwordHash
    ? await Bun.password.verify('Admin@2026', u.passwordHash) || await Bun.password.verify('Novastar2026!', u.passwordHash)
    : false
  console.log(`- ${u.email} | role: ${u.role?.name || 'none'} | active: ${u.isActive} | hash present: ${!!u.passwordHash} | password verifies: ${pwOk}`)
}

await prisma.$disconnect()

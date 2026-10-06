#!/usr/bin/env bun
// Seed script — Populates database with Ghana/NaCCA baseline data
//
// Run with: bun run db:seed (or: bun run seed/index.ts)
// Requires, in the environment:
//   DATABASE_URL             — connection string, refused without it
//   SEED_HEADMASTER_PASSWORD — refused without it; there is no default
//   SEED_PORTAL_ADMIN_PASSWORD — refused without it; there is no default
// Optional: SEED_SKIP_DOTENV=1 ignores the repo root .env (as MIGRATE_SKIP_DOTENV
// does for tools/migrate), and SEED_ALLOW_DEFAULT_PASSWORDS=1 opts into the
// committed fallbacks against a LOCAL database only — a pair of locks that cannot
// currently both open, because this Prisma client speaks SQL-over-HTTP and no local
// PostgreSQL server can serve it. Both variables are listed in turbo.json's
// globalEnv, because turbo filters every other variable out of a task's
// environment and a seed that silently reads a published fallback instead of the
// value you exported is worse than no seed.
// See ./credentials.ts for the refusal and why the fallbacks are unreachable.

import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { ADMISSIONS_OPEN_FLAG_KEY, PERMISSION_CATALOG, permissionsForRole } from '@novastar/shared-types'
// Imported for its band definitions rather than re-typed here. By relative path
// on purpose: `tools/seed` has no package.json of its own, so it resolves against
// the repo root, whose node_modules carries no workspace links. The package is
// consumed as TypeScript source and its only other import is `import type`, which
// is erased, so nothing else has to resolve at run time either.
import { NACCA_6_LEVEL } from '../../packages/ghana-education'
// The band-coverage check is the shared validator, not a copy of it: the admin
// write path calls the same one through `ENTITY_CONFIG_MAP.grading_level`, and a
// second implementation here is exactly how a scale became creatable through
// Settings that the seed would have refused. Imported by relative path for the
// same reason as above — `tools/seed` resolves against the repo root.
import { assertBandsCoverZeroToHundred } from '../../packages/shared-utils'
import { Phase, SubjectCategory, TermStatus, Gender, StaffStatus, UserStatus, ContentStatus } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
// Credential resolution, and the refusal that guards it, live in `./credentials`
// so they can be tested with no database and no Prisma client. This file keeps
// only the call, at the top of main(), for the reason spelled out there.
import { resolveSeedCredentials, SeedCredentialsError } from './credentials'

// Load .env from project root.
//
// `SEED_SKIP_DOTENV=1` skips the file, named for `MIGRATE_SKIP_DOTENV` in
// tools/migrate, which is the repository's existing spelling for this. It is not
// a convenience: the loader below ASSIGNS over whatever the shell already set,
// so a `.env` naming a shared database wins over the developer's own
// environment. An escape hatch is how a test run — or a CI step that meant to
// exercise the refusal below — is prevented from pointing at production.
//
// It is deliberately NOT in `turbo.json`'s `globalEnv`, unlike the two password
// variables. Turbo only forwards a variable it is told about, so leaving this one
// out means the `bun run db:seed` path cannot skip `.env` at all. For a script
// that installs credentials into a live database, that is the direction to err
// in, and `db:seed` is `cache: false` anyway, so there is no cache key for it
// to be missing from.
if (process.env.SEED_SKIP_DOTENV !== '1') {
  const envPath = path.resolve(__dirname, '../../.env')
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
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('❌ DATABASE_URL not set in environment')
  console.error('   Create .env in project root with: DATABASE_URL="postgresql://..."')
  process.exit(1)
}

const adapter = new PrismaNeon({ connectionString })
const prisma = new PrismaClient({ adapter })

// ---------------------------------------------------------------------------
// Grading defaults
// ---------------------------------------------------------------------------
// Percentage is the unit of grading. A band is the label and colour a school
// reports a percentage under, and `order` is presentation order only — band
// lookup is by percentage range, so the two directions a school might pick
// (higher is better, lower is better) are equally expressible.

interface SeedBand {
  key: string
  label: string
  minScore: number
  maxScore: number
  color: string
  description: string
  order: number
}

/**
 * Bands for the primary default, derived from the NaCCA 6-level scale in
 * @novastar/ghana-education rather than re-typed here, so the definitions live in
 * one place and cannot drift from the curriculum engine.
 *
 * NaCCA counts a HIGHER level as better, so the key keeps NaCCA's own level
 * number (`level_6` is Level 6, Excellent) while `order` is assigned best-first
 * for display.
 */
const PRIMARY_DEFAULT_BANDS: SeedBand[] = [...NACCA_6_LEVEL.levels]
  .map((band) => ({
    key: `level_${band.key.replace(/^level/, '')}`,
    label: band.label,
    minScore: band.minScore,
    maxScore: band.maxScore,
    color: band.color,
    description: band.description ?? '',
  }))
  .sort((a, b) => b.maxScore - a.maxScore)
  .map((band, index) => ({ ...band, order: index + 1 }))

/**
 * Bands for the JHS default: WAEC's published percentage interpretation of the
 * BECE 1-9 scale. Direction is LOWER-is-better — grade 1 is the best result —
 * which is why `order` is not the same as the key.
 *
 * COMPLIANCE — this is the one place in the codebase that must not be misread.
 * WAEC's live BECE marking is norm-referenced (stanine): the boundaries shift
 * with the national cohort every year, and only WAEC computes them. These fixed
 * bands reproduce the *published percentage interpretation* so a school can label
 * its own internal terminal report, and for nothing else. This software must not
 * be represented as generating official BECE results, and no output derived from
 * these bands may be presented as an official result.
 *
 * The colours are a school-editable ramp from best to worst, not a WAEC colour
 * scheme. The report colours a band by the band's own colour and never by the
 * numeric size of the score, so a school can replace any of it.
 */
const JHS_DEFAULT_BANDS: SeedBand[] = [
  { key: 'grade_1', label: 'Grade 1 (Excellent)', minScore: 75, maxScore: 100, color: '#047857', description: '75-100% - Excellent', order: 1 },
  { key: 'grade_2', label: 'Grade 2 (Very Good)', minScore: 70, maxScore: 74, color: '#059669', description: '70-74% - Very Good', order: 2 },
  { key: 'grade_3', label: 'Grade 3 (Good)', minScore: 65, maxScore: 69, color: '#65a30d', description: '65-69% - Good', order: 3 },
  { key: 'grade_4', label: 'Grade 4 (Credit)', minScore: 60, maxScore: 64, color: '#ca8a04', description: '60-64% - Credit', order: 4 },
  { key: 'grade_5', label: 'Grade 5 (Credit)', minScore: 55, maxScore: 59, color: '#d97706', description: '55-59% - Credit', order: 5 },
  { key: 'grade_6', label: 'Grade 6 (Credit)', minScore: 50, maxScore: 54, color: '#ea580c', description: '50-54% - Credit', order: 6 },
  { key: 'grade_7', label: 'Grade 7 (Pass)', minScore: 45, maxScore: 49, color: '#f97316', description: '45-49% - Pass', order: 7 },
  { key: 'grade_8', label: 'Grade 8 (Pass)', minScore: 40, maxScore: 44, color: '#fb923c', description: '40-44% - Pass', order: 8 },
  { key: 'grade_9', label: 'Grade 9 (Fail)', minScore: 0, maxScore: 39, color: '#dc2626', description: '0-39% - Fail', order: 9 },
]

/**
 * Refuse a grading scale that does not cover 0-100 exactly once.
 *
 * `assertBandsCoverZeroToHundred` now lives in @novastar/shared-utils, next to
 * `resolveGradeBand`, because the seed is no longer the only thing that has to
 * know it: a school can also build a scale band by band through
 * `/api/config/grading_level`, and that path enforces the same rule through the
 * registry. What is left here is the call.
 */

/**
 * Create or refresh one default grading scale.
 *
 * Every band carries `tenantId` explicitly: `GradingLevel.tenantId` is required
 * and Prisma does not propagate the parent's `tenantId` through a nested create,
 * so omitting it fails the seed with a missing-required-field error.
 *
 * `legacyName` renames a superseded seed row in place instead of creating a
 * second scale beside it. The scale keeps its id, so `Score.gradingScaleId` keeps
 * resolving, and two scales cannot end up claiming the same levels — which would
 * make which one wins a function of row order. The bands are rewritten either
 * way: `@@unique([gradingScaleId, key])` and `@@unique([gradingScaleId, order])`
 * mean a re-seed cannot add a band without clearing the old set.
 *
 * `include: { levels: true }` is not optional decoration. `levels` is a relation,
 * so a write that only touches it returns the scale's scalars and nothing else —
 * the caller that validates the bands would read `undefined` and pass that to
 * `assertBandsCoverZeroToHundred`, which then throws on a scale it was supposed
 * to be checking. Returning the bands that actually landed is also the only
 * version of this guard that checks the database rather than the intent.
 */
async function upsertGradingScale(params: {
  tenantId: string
  schoolId: string
  name: string
  legacyName?: string
  description: string
  isDefault: boolean
  appliesToLevels: string[]
  bands: SeedBand[]
}) {
  const { tenantId, schoolId, name, legacyName, description, isDefault, appliesToLevels, bands } = params

  const existing =
    (await prisma.gradingScale.findFirst({ where: { tenantId, schoolId, name } })) ??
    (legacyName
      ? await prisma.gradingScale.findFirst({ where: { tenantId, schoolId, name: legacyName } })
      : null)

  const levelRows = bands.map((band) => ({ tenantId, ...band }))
  const scalars = {
    name,
    description,
    isDefault,
    appliesToLevels,
  }

  if (existing) {
    return prisma.gradingScale.update({
      where: { id: existing.id },
      data: { ...scalars, levels: { deleteMany: {}, create: levelRows } },
      include: { levels: true },
    })
  }
  // `deleteMany` belongs to the nested update input only. A nested create has no
  // rows to clear, and Prisma rejects the argument outright rather than ignoring it.
  return prisma.gradingScale.create({
    data: { tenantId, schoolId, ...scalars, levels: { create: levelRows } },
    include: { levels: true },
  })
}

async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password, { algorithm: 'argon2id' })
}

async function main() {
  // ============ CREDENTIALS (refused before anything is written) ============
  // This is the first statement in main() on purpose, and it has to stay first.
  // A refusal is only worth having if it is complete: the tenant and school
  // upserts that follow are writes, so a check placed after them would refuse a
  // run that had already left a Tenant, a School, academic years, terms, class
  // levels and 19 subjects behind on a database the operator was told had not
  // been touched. There is no transaction spanning the seed, so "nothing was
  // written" has to be true by ordering, not by rollback.
  //
  // Resolving here also means the two hashes below are known before the first
  // query, so the refusal costs one property read and zero network traffic.
  //
  // Thrown, not `process.exit`-ed here, so the handler at the bottom of the file
  // owns the message and the exit code in one place — the same shape as every
  // other refusal in the seed (the band-coverage check, the weight-sum check),
  // all of which throw out of main().
  const seedCredentials = resolveSeedCredentials()

  if (seedCredentials.usingCommittedDefaults) {
    console.warn(
      '⚠️  WARNING: provisioning a COMMITTED FALLBACK password. These literals are ' +
        'published in this repository; they are only accepted against a local ' +
        'database, and any of these accounts must be re-credentialed before that ' +
        'database is reachable by anyone else.',
    )
  } else {
    console.log(
      `🔐 Portal credentials taken from ${seedCredentials.headmasterSource} / ${seedCredentials.portalAdminSource}`,
    )
  }

  console.log('🌱 Starting database seed...')

  // ============ TENANT & SCHOOL ============
  const tenant = await prisma.tenant.upsert({
    where: { code: 'novastar' },
    update: {},
    create: {
      code: 'novastar',
      name: 'Novastar Montessori School',
      domain: 'novastarmontessori.com',
      isActive: true,
      settings: { language: 'en', currency: 'GHS', timezone: 'Africa/Accra' },
    },
  })

  const school = await prisma.school.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: 'main' } },
    update: {},
    create: {
      tenantId: tenant.id,
      code: 'main',
      name: 'Novastar Montessori School',
      address: 'Ayeduase New Site, K-5 Junction, Ayeduase Road, Kumasi, Ashanti Region, Ghana',
      phone: '+233 24 493 5251',
      email: 'info@novastarmontessori.com',
      motto: 'Bringing quality care and experience to learning',
      established: new Date('2016-01-01'),
    },
  })

  console.log('✅ Tenant & School created')

  // ============ ACADEMIC YEARS ============
  const currentYear = await prisma.academicYear.upsert({
    where: { tenantId_schoolId_name: { tenantId: tenant.id, schoolId: school.id, name: '2026/2027' } },
    update: {},
    create: {
      tenantId: tenant.id,
      schoolId: school.id,
      name: '2026/2027',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2027-08-31'),
      isCurrent: true,
    },
  })

  await prisma.academicYear.upsert({
    where: { tenantId_schoolId_name: { tenantId: tenant.id, schoolId: school.id, name: '2025/2026' } },
    update: {},
    create: {
      tenantId: tenant.id,
      schoolId: school.id,
      name: '2025/2026',
      startDate: new Date('2025-09-01'),
      endDate: new Date('2026-08-31'),
      isCurrent: false,
    },
  })

  console.log('✅ Academic Years created')

  // ============ TERMS ============
  const term1 = await prisma.term.upsert({
    where: { tenantId_schoolId_name_academicYearId: { tenantId: tenant.id, schoolId: school.id, name: 'Term 1', academicYearId: currentYear.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      schoolId: school.id,
      academicYearId: currentYear.id,
      name: 'Term 1',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-12-15'),
      isCurrent: true,
      status: TermStatus.ACTIVE,
      weeks: 14,
    },
  })

  await prisma.term.upsert({
    where: { tenantId_schoolId_name_academicYearId: { tenantId: tenant.id, schoolId: school.id, name: 'Term 2', academicYearId: currentYear.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      schoolId: school.id,
      academicYearId: currentYear.id,
      name: 'Term 2',
      startDate: new Date('2027-01-10'),
      endDate: new Date('2027-04-15'),
      isCurrent: false,
      status: TermStatus.PLANNING,
      weeks: 14,
    },
  })

  await prisma.term.upsert({
    where: { tenantId_schoolId_name_academicYearId: { tenantId: tenant.id, schoolId: school.id, name: 'Term 3', academicYearId: currentYear.id } },
    update: {},
    create: {
      tenantId: tenant.id,
      schoolId: school.id,
      academicYearId: currentYear.id,
      name: 'Term 3',
      startDate: new Date('2027-05-05'),
      endDate: new Date('2027-08-15'),
      isCurrent: false,
      status: TermStatus.PLANNING,
      weeks: 14,
    },
  })

  console.log('✅ Terms created')

  // ============ CLASS LEVELS (Ghana GES/NaCCA + Montessori) ============
  const classLevels = [
    // Kindergarten (Montessori)
    { code: 'CRECHE', name: 'Creche', phase: Phase.KINDERGARTEN, order: 1, ageMin: 6, ageMax: 18, tenantId: tenant.id, schoolId: school.id },
    { code: 'NURSERY1', name: 'Nursery 1', phase: Phase.KINDERGARTEN, order: 2, ageMin: 18, ageMax: 36, tenantId: tenant.id, schoolId: school.id },
    { code: 'NURSERY2', name: 'Nursery 2', phase: Phase.KINDERGARTEN, order: 3, ageMin: 36, ageMax: 48, tenantId: tenant.id, schoolId: school.id },
    { code: 'KG1', name: 'Kindergarten 1', phase: Phase.KINDERGARTEN, order: 4, ageMin: 48, ageMax: 60, tenantId: tenant.id, schoolId: school.id },
    { code: 'KG2', name: 'Kindergarten 2', phase: Phase.KINDERGARTEN, order: 5, ageMin: 60, ageMax: 72, tenantId: tenant.id, schoolId: school.id },

    // Lower Primary (B1-B3)
    { code: 'B1', name: 'Basic 1', phase: Phase.PRIMARY, order: 6, ageMin: 72, ageMax: 84, tenantId: tenant.id, schoolId: school.id },
    { code: 'B2', name: 'Basic 2', phase: Phase.PRIMARY, order: 7, ageMin: 84, ageMax: 96, tenantId: tenant.id, schoolId: school.id },
    { code: 'B3', name: 'Basic 3', phase: Phase.PRIMARY, order: 8, ageMin: 96, ageMax: 108, tenantId: tenant.id, schoolId: school.id },

    // Upper Primary (B4-B6)
    { code: 'B4', name: 'Basic 4', phase: Phase.PRIMARY, order: 9, ageMin: 108, ageMax: 120, tenantId: tenant.id, schoolId: school.id },
    { code: 'B5', name: 'Basic 5', phase: Phase.PRIMARY, order: 10, ageMin: 120, ageMax: 132, tenantId: tenant.id, schoolId: school.id },
    { code: 'B6', name: 'Basic 6', phase: Phase.PRIMARY, order: 11, ageMin: 132, ageMax: 144, tenantId: tenant.id, schoolId: school.id },

    // Junior High (JHS 1-3 / B7-B9)
    { code: 'B7', name: 'JHS 1 (Basic 7)', phase: Phase.JHS, order: 12, ageMin: 144, ageMax: 156, tenantId: tenant.id, schoolId: school.id },
    { code: 'B8', name: 'JHS 2 (Basic 8)', phase: Phase.JHS, order: 13, ageMin: 156, ageMax: 168, tenantId: tenant.id, schoolId: school.id },
    { code: 'B9', name: 'JHS 3 (Basic 9)', phase: Phase.JHS, order: 14, ageMin: 168, ageMax: 180, tenantId: tenant.id, schoolId: school.id },
  ]

  for (const cl of classLevels) {
    await prisma.classLevel.upsert({
      where: { tenantId_schoolId_code: { tenantId: tenant.id, schoolId: school.id, code: cl.code } },
      update: {},
      create: cl,
    })
  }

  console.log('✅ Class Levels created (14 levels)')

  // ============ SUBJECTS (GES/NaCCA + Montessori) ============
  const subjects = [
    // Core Languages
    { code: 'ENG', name: 'English Language', category: SubjectCategory.LANGUAGE, isCore: true, creditHours: 5, tenantId: tenant.id, schoolId: school.id },
    { code: 'TWI', name: 'Twi (Asante)', category: SubjectCategory.LANGUAGE, isCore: true, creditHours: 4, tenantId: tenant.id, schoolId: school.id },
    { code: 'FRE', name: 'French', category: SubjectCategory.LANGUAGE, isCore: false, creditHours: 2, tenantId: tenant.id, schoolId: school.id },

    // Mathematics & Science
    { code: 'MATH', name: 'Mathematics', category: SubjectCategory.MATHEMATICS, isCore: true, creditHours: 5, tenantId: tenant.id, schoolId: school.id },
    { code: 'SCI', name: 'Integrated Science', category: SubjectCategory.SCIENCE, isCore: true, creditHours: 4, tenantId: tenant.id, schoolId: school.id },
    { code: 'ICT', name: 'Computing / ICT', category: SubjectCategory.ICT, isCore: true, creditHours: 2, tenantId: tenant.id, schoolId: school.id },

    // Social Studies
    { code: 'SOC', name: 'Social Studies', category: SubjectCategory.SOCIAL_STUDIES, isCore: true, creditHours: 3, tenantId: tenant.id, schoolId: school.id },
    { code: 'RME', name: 'Religious & Moral Education', category: SubjectCategory.RELIGIOUS_MORAL, isCore: true, creditHours: 2, tenantId: tenant.id, schoolId: school.id },

    // Creative & Physical
    { code: 'ART', name: 'Creative Arts', category: SubjectCategory.CREATIVE_ARTS, isCore: false, creditHours: 2, tenantId: tenant.id, schoolId: school.id },
    { code: 'PE', name: 'Physical Education', category: SubjectCategory.PHYSICAL_EDUCATION, isCore: false, creditHours: 2, tenantId: tenant.id, schoolId: school.id },
    { code: 'MUSIC', name: 'Music & Dance', category: SubjectCategory.CREATIVE_ARTS, isCore: false, creditHours: 1, tenantId: tenant.id, schoolId: school.id },

    // Montessori Specific
    { code: 'MPRAC', name: 'Practical Life', category: SubjectCategory.MONTESSORI_PRACTICAL, isCore: true, creditHours: 3, tenantId: tenant.id, schoolId: school.id },
    { code: 'MSENS', name: 'Sensorial', category: SubjectCategory.MONTESSORI_SENSORIAL, isCore: true, creditHours: 3, tenantId: tenant.id, schoolId: school.id },
    { code: 'MLANG', name: 'Montessori Language', category: SubjectCategory.MONTESSORI_LANGUAGE, isCore: true, creditHours: 4, tenantId: tenant.id, schoolId: school.id },
    { code: 'MMATH', name: 'Montessori Mathematics', category: SubjectCategory.MONTESSORI_MATHEMATICS, isCore: true, creditHours: 4, tenantId: tenant.id, schoolId: school.id },
    { code: 'MCULT', name: 'Montessori Cultural', category: SubjectCategory.MONTESSORI_CULTURAL, isCore: true, creditHours: 3, tenantId: tenant.id, schoolId: school.id },

    // JHS Specific
    { code: 'GHANA', name: 'Ghanaian Language (Twi/Ewe/Ga)', category: SubjectCategory.LANGUAGE, isCore: true, creditHours: 3, tenantId: tenant.id, schoolId: school.id },
    { code: 'BDT', name: 'Basic Design & Technology', category: SubjectCategory.CREATIVE_ARTS, isCore: false, creditHours: 2, tenantId: tenant.id, schoolId: school.id },
    { code: 'HOME', name: 'Home Economics', category: SubjectCategory.OTHER, isCore: false, creditHours: 2, tenantId: tenant.id, schoolId: school.id },
  ]

  for (const sub of subjects) {
    await prisma.subject.upsert({
      where: { tenantId_schoolId_code: { tenantId: tenant.id, schoolId: school.id, code: sub.code } },
      update: {},
      create: sub,
    })
  }

  console.log('✅ Subjects created (19 subjects)')

  // ============ SUBJECT LEVELS (Map subjects to class levels) ============
  const allSubjects = await prisma.subject.findMany({ where: { tenantId: tenant.id, schoolId: school.id } })
  const allLevels = await prisma.classLevel.findMany({ where: { tenantId: tenant.id, schoolId: school.id } })

  // Core subjects for all levels
  const coreSubjectCodes = ['ENG', 'TWI', 'MATH', 'SCI', 'ICT', 'SOC', 'RME']
  const montessoriSubjectCodes = ['MPRAC', 'MSENS', 'MLANG', 'MMATH', 'MCULT']
  const primarySubjectCodes = ['FRE', 'ART', 'PE', 'MUSIC', 'BDT', 'HOME']
  const jhsSubjectCodes = ['GHANA', 'FRE', 'ART', 'PE', 'MUSIC', 'BDT', 'HOME']

  for (const level of allLevels) {
    // Core for all
    for (const code of coreSubjectCodes) {
      const sub = allSubjects.find(s => s.code === code)
      if (sub) {
        await prisma.subjectLevel.upsert({
          where: { tenantId_subjectId_classLevelId: { tenantId: tenant.id, subjectId: sub.id, classLevelId: level.id } },
          update: {},
          create: { tenantId: tenant.id, subjectId: sub.id, classLevelId: level.id, isRequired: true, periodsPerWeek: 4 },
        })
      }
    }

    // Montessori for Kindergarten
    if (level.phase === Phase.KINDERGARTEN) {
      for (const code of montessoriSubjectCodes) {
        const sub = allSubjects.find(s => s.code === code)
        if (sub) {
          await prisma.subjectLevel.upsert({
            where: { tenantId_subjectId_classLevelId: { tenantId: tenant.id, subjectId: sub.id, classLevelId: level.id } },
            update: {},
            create: { tenantId: tenant.id, subjectId: sub.id, classLevelId: level.id, isRequired: true, periodsPerWeek: 3 },
          })
        }
      }
    }

    // Primary specific
    if (level.phase === Phase.PRIMARY) {
      for (const code of primarySubjectCodes) {
        const sub = allSubjects.find(s => s.code === code)
        if (sub) {
          await prisma.subjectLevel.upsert({
            where: { tenantId_subjectId_classLevelId: { tenantId: tenant.id, subjectId: sub.id, classLevelId: level.id } },
            update: {},
            create: { tenantId: tenant.id, subjectId: sub.id, classLevelId: level.id, isRequired: true, periodsPerWeek: 2 },
          })
        }
      }
    }

    // JHS specific
    if (level.phase === Phase.JHS) {
      for (const code of jhsSubjectCodes) {
        const sub = allSubjects.find(s => s.code === code)
        if (sub) {
          await prisma.subjectLevel.upsert({
            where: { tenantId_subjectId_classLevelId: { tenantId: tenant.id, subjectId: sub.id, classLevelId: level.id } },
            update: {},
            create: { tenantId: tenant.id, subjectId: sub.id, classLevelId: level.id, isRequired: true, periodsPerWeek: 3 },
          })
        }
      }
    }
  }

  console.log('✅ Subject Levels mapped')

  // ============ GRADING SCALES (school-configurable templates) ============
  // Percentage is the unit of grading; a band is the label and colour the school
  // reports a percentage under. Both scales below are DEFAULTS, seeded so a
  // school is useful on day one and editable afterwards with no code change —
  // rename them, retune a boundary, replace the set, or add a fourth scale.
  //
  // Nothing in the application chooses between them by Phase. Which scale
  // applies to a class is resolved from the scale's own `appliesToLevels`
  // (`resolveApplicableGradingScale` in @novastar/shared-utils), so a school that
  // invents its own bands is graded on its own terms.
  const primaryScale = await upsertGradingScale({
    tenantId: tenant.id,
    schoolId: school.id,
    name: 'Ghana Primary (GES 6-level)',
    legacyName: 'GES Standard (A-F)',
    description:
      'Default primary template, editable at Settings. Bands are the NaCCA 6-level standards scale: Level 6 Excellent (85-100%) down to Level 1 Below Partial (0-39%). HIGHER level is better. The percentage is the mark; this is only how it is labelled and coloured.',
    isDefault: true,
    appliesToLevels: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'],
    bands: PRIMARY_DEFAULT_BANDS,
  })

  const jhsScale = await upsertGradingScale({
    tenantId: tenant.id,
    schoolId: school.id,
    name: 'Ghana JHS (BECE 1-9)',
    description:
      'Default JHS template, editable at Settings. Bands are WAEC published percentage interpretation of BECE grades 1-9. LOWER grade number is better: grade 1 Excellent (75-100%), grade 9 Fail (0-39%). Internal terminal reporting only.',
    isDefault: false,
    appliesToLevels: ['B7', 'B8', 'B9'],
    bands: JHS_DEFAULT_BANDS,
  })

  // The former "Montessori Observational" seed template is deliberately NOT
  // deleted or rewritten here. It was aimed at Creche/KG, which neither Ghana
  // default covers, and it carries no `isDefault`, so it can never win the
  // tie-break in `resolveApplicableGradingScale`. Deleting a scale a school
  // already has grades against would destroy that history for no gain; leaving
  // an existing one alone means a database seeded before this change keeps it and
  // a fresh database simply does not have it. A school with Creche/KG classes
  // configures a scale for them at Settings.

  // A gap or an overlap in a seeded scale mis-grades a child quietly: a gap
  // leaves a percentage with no label at all, and an overlap hands it to whichever
  // band sorts first. Both are off-by-one mistakes in data, so both are refused
  // here rather than discovered on a report card.
  //
  // This is the STRICT check, and it is deliberately stricter than the admin write
  // path. The seed asserts full 0-100 coverage; a hand-built scale at Settings is
  // held only to `findGradeBandWriteConflicts` — no band backwards, none outside
  // 0-100, none doubling up a percentage. Coverage is not enforceable there,
  // because a two-row boundary retune necessarily passes through a state that is
  // temporarily a hole, so refusing every hole would make every legitimate retune
  // impossible. A hole a school creates is caught at grading time instead:
  // `resolveGradeBand` returns null rather than guessing, and the report names the
  // range on the card.
  for (const scale of [primaryScale, jhsScale]) {
    assertBandsCoverZeroToHundred(scale.name, scale.levels)
  }

  console.log('✅ Grading Scales created (editable templates: Ghana Primary GES 6-level, Ghana JHS BECE 1-9)')

  // ============ ASSESSMENT TYPES ============
  // The school's own continuous assessment scheme. This is a STARTING TEMPLATE:
  // a head teacher retunes these at Settings (Assessment Types), and the report
  // composes whatever is configured at the time.
  //
  // `defaultWeight` is a RELATIVE weight, not a share of the terminal mark. The
  // report composes a normalised weighted mean, `sum(pct x weight) / sum(weight)`,
  // so only the ratio between components matters and the set is not required to
  // sum to 1 — it usually cannot, because SBA is recorded three times in a term
  // (SBA 1, SBA 2, SBA 3) and each carries the SBA weight. The absolute-share
  // alternative overflows past 100% on exactly that rollup.
  //
  // These template numbers DO add up to 1.00 because that is what a head teacher
  // reads most easily, not because the arithmetic demands it.
  const assessmentTypes = [
    { code: 'CLASSWORK', name: 'Classwork', defaultWeight: 0.15, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
    { code: 'HOMEWORK', name: 'Homework', defaultWeight: 0.05, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
    { code: 'QUIZ', name: 'Quiz', defaultWeight: 0.10, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
    { code: 'PROJECT', name: 'Project', defaultWeight: 0.10, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
    { code: 'MIDTERM', name: 'Midterm Exam', defaultWeight: 0.15, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
    { code: 'FINAL', name: 'Final Exam', defaultWeight: 0.15, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
    { code: 'SBA', name: 'School-Based Assessment', defaultWeight: 0.30, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
  ]

  // Refuse to seed a scheme that cannot be composed. An all-zero or negative set
  // leaves every terminal percentage undefined, and discovering that from a blank
  // report card after a school has been seeded is the worst possible moment to
  // find out.
  const weightTotal = assessmentTypes.reduce((sum, at) => sum + at.defaultWeight, 0)
  if (!Number.isFinite(weightTotal) || weightTotal <= 0) {
    throw new Error(
      `Seed refused: assessment-type weights must be finite and sum above 0, got ${weightTotal}. ` +
      'A terminal percentage is sum(pct x weight) / sum(weight); with no weight there is nothing to divide by.',
    )
  }
  for (const at of assessmentTypes) {
    if (!Number.isFinite(at.defaultWeight) || at.defaultWeight < 0) {
      throw new Error(
        `Seed refused: assessment type ${at.code} has weight ${at.defaultWeight}; weights must be finite and not negative.`,
      )
    }
  }

  for (const at of assessmentTypes) {
    const existing = await prisma.assessmentTypeConfig.findFirst({
      where: { tenantId: tenant.id, schoolId: school.id, code: at.code }
    })
    if (existing) {
      await prisma.assessmentTypeConfig.update({
        where: { id: existing.id },
        data: { ...at, isActive: true, appliesToLevels: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9'] }
      })
    } else {
      await prisma.assessmentTypeConfig.create({
        data: { ...at, isActive: true, appliesToLevels: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9'] }
      })
    }
  }

  console.log('✅ Assessment Types created')

  // ============ ASSESSMENTS: NONE, DELIBERATELY ============
  // There is no `Assessment` write anywhere in this seed, and that is the honest
  // answer to "what does the seed put in `Assessment.weight`": nothing.
  //
  // It matters because the column is now nullable. `Assessment.weight` was
  // `NOT NULL DEFAULT 1`, which made "no weight of its own" indistinguishable from
  // "explicitly 1.00" and forced `resolveAssessmentWeight` to treat a stored 1 as
  // unset — silently discarding a teacher's deliberate 1.00. NULL now means unset
  // and the type's configured weight applies; 1.00 means 1.00. No seed row needs
  // rewriting, because no seed row exists.
  //
  // A school creates assessments through `POST /api/assessments`, which now
  // leaves `Assessment.weight` NULL so the type's configured `defaultWeight`
  // actually applies. It used to copy that default onto the row, which pinned
  // every assessment at the weight its type happened to carry at creation and
  // made a later retune of the type inert — the report said "weight set on this
  // assessment" while the school believed it had changed the scheme.
  //
  // Rows created before that change still hold the copied weight, so a retune
  // still will not reach them. Nulling them is a data migration and a decision
  // for an owner, not something a seed should do behind their back.

  // ============ FEE CATEGORIES ============
  const feeCategories = [
    { code: 'TUITION', name: 'Tuition Fee', isRecurring: true, defaultMandatory: true, sortOrder: 1, tenantId: tenant.id, schoolId: school.id },
    { code: 'UNIFORM', name: 'Uniform', isRecurring: false, defaultMandatory: true, sortOrder: 2, tenantId: tenant.id, schoolId: school.id },
    { code: 'BOOKS', name: 'Textbooks & Materials', isRecurring: false, defaultMandatory: true, sortOrder: 3, tenantId: tenant.id, schoolId: school.id },
    { code: 'EXAM', name: 'Examination Fee', isRecurring: true, defaultMandatory: true, sortOrder: 4, tenantId: tenant.id, schoolId: school.id },
    { code: 'PTA', name: 'PTA Levy', isRecurring: true, defaultMandatory: false, sortOrder: 5, tenantId: tenant.id, schoolId: school.id },
    { code: 'TRANSPORT', name: 'Transport', isRecurring: true, defaultMandatory: false, sortOrder: 6, tenantId: tenant.id, schoolId: school.id },
    { code: 'MEALS', name: 'School Meals', isRecurring: true, defaultMandatory: false, sortOrder: 7, tenantId: tenant.id, schoolId: school.id },
    { code: 'CLUB', name: 'Club/Activity Fee', isRecurring: false, defaultMandatory: false, sortOrder: 8, tenantId: tenant.id, schoolId: school.id },
    { code: 'GRADUATION', name: 'Graduation Fee', isRecurring: false, defaultMandatory: false, sortOrder: 9, tenantId: tenant.id, schoolId: school.id },
  ]

  for (const fc of feeCategories) {
    const existing = await prisma.feeCategory.findFirst({
      where: { tenantId: tenant.id, schoolId: school.id, code: fc.code }
    })
    if (existing) {
      await prisma.feeCategory.update({
        where: { id: existing.id },
        data: fc
      })
    } else {
      await prisma.feeCategory.create({ data: fc })
    }
  }

  console.log('✅ Fee Categories created')

  // ============ PAYMENT METHODS (Ghana) ============
  const paymentMethods = [
    { code: 'MOMO', name: 'MTN Mobile Money', instructions: 'Pay to merchant number 0244935251. Reference: Student ID', isEnabled: true, sortOrder: 1, providerConfig: { provider: 'MTN', type: 'momo' }, tenantId: tenant.id, schoolId: school.id },
    { code: 'VODAFONE_CASH', name: 'Vodafone Cash', instructions: 'Pay to 0501234567. Reference: Student ID', isEnabled: true, sortOrder: 2, providerConfig: { provider: 'Vodafone', type: 'momo' }, tenantId: tenant.id, schoolId: school.id },
    { code: 'AIRTEL_MONEY', name: 'AirtelTigo Money', instructions: 'Pay to 0271234567. Reference: Student ID', isEnabled: true, sortOrder: 3, providerConfig: { provider: 'AirtelTigo', type: 'momo' }, tenantId: tenant.id, schoolId: school.id },
    { code: 'BANK_TRANSFER', name: 'Bank Transfer', instructions: 'Bank: GCB Bank | Account: 1234567890 | Branch: Kumasi Main | Ref: Student ID', isEnabled: true, sortOrder: 4, providerConfig: { bank: 'GCB', account: '1234567890' }, tenantId: tenant.id, schoolId: school.id },
    { code: 'CASH', name: 'Cash at Office', instructions: 'Pay at the school accounts office during business hours (8am-4pm). Collect official receipt.', isEnabled: true, sortOrder: 5, providerConfig: { type: 'cash' }, tenantId: tenant.id, schoolId: school.id },
    { code: 'CHEQUE', name: 'Banker\'s Cheque', instructions: 'Make cheque payable to "Novastar Montessori School". Write student ID on back.', isEnabled: true, sortOrder: 6, providerConfig: { type: 'cheque' }, tenantId: tenant.id, schoolId: school.id },
  ]

  for (const pm of paymentMethods) {
    const existing = await prisma.paymentMethodConfig.findFirst({
      where: { tenantId: tenant.id, schoolId: school.id, code: pm.code }
    })
    if (existing) {
      await prisma.paymentMethodConfig.update({
        where: { id: existing.id },
        data: pm
      })
    } else {
      await prisma.paymentMethodConfig.create({ data: pm })
    }
  }

  console.log('✅ Payment Methods created (Ghana MoMo + Bank + Cash)')

  // ============ FEE STRUCTURES (per class level, per term) ============
  const categories = await prisma.feeCategory.findMany({ where: { tenantId: tenant.id, schoolId: school.id } })
  const tuitionCat = categories.find(c => c.code === 'TUITION')!
  const uniformCat = categories.find(c => c.code === 'UNIFORM')!
  const booksCat = categories.find(c => c.code === 'BOOKS')!
  const examCat = categories.find(c => c.code === 'EXAM')!

  const feeStructures = [
    // Kindergarten (CRECHE-KG2) - Term 1
    { name: 'Creche-Nursery Term 1', academicYearId: currentYear.id, termId: term1.id, classLevelCode: 'CRECHE', lineItems: [tuitionCat, uniformCat, booksCat, examCat], amounts: [1200, 300, 200, 100] },
    { name: 'KG1-KG2 Term 1', academicYearId: currentYear.id, termId: term1.id, classLevelCode: 'KG1', lineItems: [tuitionCat, uniformCat, booksCat, examCat], amounts: [1500, 350, 250, 150] },
    // Primary (B1-B6) - Term 1
    { name: 'Lower Primary Term 1', academicYearId: currentYear.id, termId: term1.id, classLevelCode: 'B1', lineItems: [tuitionCat, uniformCat, booksCat, examCat], amounts: [1800, 400, 300, 200] },
    { name: 'Upper Primary Term 1', academicYearId: currentYear.id, termId: term1.id, classLevelCode: 'B4', lineItems: [tuitionCat, uniformCat, booksCat, examCat], amounts: [2200, 450, 350, 250] },
    // JHS (B7-B9) - Term 1
    { name: 'JHS Term 1', academicYearId: currentYear.id, termId: term1.id, classLevelCode: 'B7', lineItems: [tuitionCat, uniformCat, booksCat, examCat], amounts: [2800, 500, 400, 300] },
  ]

  for (const fs of feeStructures) {
    const level = await prisma.classLevel.findFirst({ where: { tenantId: tenant.id, schoolId: school.id, code: fs.classLevelCode } })
    if (!level) continue

    const existingStructure = await prisma.feeStructure.findFirst({
      where: { tenantId: tenant.id, schoolId: school.id, name: fs.name, academicYearId: fs.academicYearId, classLevelId: level.id }
    })

    const structure = existingStructure
      ? await prisma.feeStructure.update({
          where: { id: existingStructure.id },
          data: { tenantId: tenant.id, schoolId: school.id, name: fs.name, academicYearId: fs.academicYearId, termId: fs.termId, classLevelId: level.id, isActive: true },
        })
      : await prisma.feeStructure.create({
          data: { tenantId: tenant.id, schoolId: school.id, name: fs.name, academicYearId: fs.academicYearId, termId: fs.termId, classLevelId: level.id, isActive: true },
        })

    for (let i = 0; i < fs.lineItems.length; i++) {
      const existingLine = await prisma.feeLineItem.findFirst({
        where: { tenantId: tenant.id, feeStructureId: structure.id, categoryId: fs.lineItems[i].id }
      })
      if (existingLine) {
        await prisma.feeLineItem.update({
          where: { id: existingLine.id },
          data: { tenantId: tenant.id, feeStructureId: structure.id, categoryId: fs.lineItems[i].id, amount: fs.amounts[i], isMandatory: true, sortOrder: i },
        })
      } else {
        await prisma.feeLineItem.create({
          data: { tenantId: tenant.id, feeStructureId: structure.id, categoryId: fs.lineItems[i].id, amount: fs.amounts[i], isMandatory: true, sortOrder: i },
        })
      }
    }
  }

  console.log('✅ Fee Structures created')

  // ============ ROLES & PERMISSIONS ============
  // The vocabulary lives in @novastar/shared-types so the seed, the API route
  // guards and the authorization tests cannot drift apart. It was previously a
  // literal array here while PermissionSchema asserted a two-segment key regex
  // that rejected 11 of these rows.
  const permissions = PERMISSION_CATALOG.map(({ key, resource, action, scope, category, description }) => ({
    key,
    resource,
    action,
    scope,
    category,
    description,
    tenantId: tenant.id,
    isSystem: true,
  }))

  for (const perm of permissions) {
    const existing = await prisma.permission.findFirst({
      where: { tenantId: tenant.id, key: perm.key }
    })
    if (existing) {
      await prisma.permission.update({
        where: { id: existing.id },
        data: perm
      })
    } else {
      await prisma.permission.create({ data: perm })
    }
  }

  const roles = [
    { name: 'HEADMASTER', description: 'School Headmaster/Headmistress - full access', isSystem: true, permissions: permissionsForRole('HEADMASTER', PERMISSION_CATALOG), inheritsFrom: [], tenantId: tenant.id, schoolId: school.id },
    { name: 'ASSISTANT_HEAD', description: 'Assistant Headmaster/Headmistress', isSystem: true, permissions: permissionsForRole('ASSISTANT_HEAD', PERMISSION_CATALOG), inheritsFrom: [], tenantId: tenant.id, schoolId: school.id },
    { name: 'HEAD_TEACHER', description: 'Head Teacher - academic oversight', isSystem: true, permissions: permissionsForRole('HEAD_TEACHER', PERMISSION_CATALOG), inheritsFrom: [], tenantId: tenant.id, schoolId: school.id },
    { name: 'CLASSROOM_TEACHER', description: 'Classroom Teacher', isSystem: true, permissions: permissionsForRole('CLASSROOM_TEACHER', PERMISSION_CATALOG), inheritsFrom: [], tenantId: tenant.id, schoolId: school.id },
    { name: 'ACCOUNTANT', description: 'School Accountant/Bursar', isSystem: true, permissions: permissionsForRole('ACCOUNTANT', PERMISSION_CATALOG), inheritsFrom: [], tenantId: tenant.id, schoolId: school.id },
    { name: 'ADMIN_STAFF', description: 'Administrative Staff', isSystem: true, permissions: permissionsForRole('ADMIN_STAFF', PERMISSION_CATALOG), inheritsFrom: [], tenantId: tenant.id, schoolId: school.id },
    { name: 'PARENT', description: 'Parent/Guardian', isSystem: true, permissions: permissionsForRole('PARENT', PERMISSION_CATALOG), inheritsFrom: [], tenantId: tenant.id, schoolId: school.id },
    { name: 'ADMISSIONS_OFFICER', description: 'Admissions Officer - manages admissions and enrollment', isSystem: true, permissions: permissionsForRole('ADMISSIONS_OFFICER', PERMISSION_CATALOG), inheritsFrom: [], tenantId: tenant.id, schoolId: school.id },
  ]

  for (const role of roles) {
    const existing = await prisma.role.findFirst({
      where: { tenantId: tenant.id, schoolId: school.id, name: role.name }
    })
    if (existing) {
      await prisma.role.update({
        where: { id: existing.id },
        data: role
      })
    } else {
      await prisma.role.create({ data: role })
    }
  }

  console.log('✅ Roles & Permissions created')

  // ============ BRANDING ============
  const existingBranding = await prisma.branding.findFirst({
    where: { tenantId: tenant.id, schoolId: school.id }
  })

  if (existingBranding) {
    await prisma.branding.update({
      where: { id: existingBranding.id },
      data: {
        name: 'Novastar Montessori School',
        primaryColor: '#059669',
        secondaryColor: '#0891b2',
        accentColor: '#d97706',
        motto: 'Bringing quality care and experience to learning',
        address: 'Ayeduase New Site, K-5 Junction, Ayeduase Road, Kumasi, Ashanti Region, Ghana',
        phone: '+233 24 493 5251',
        email: 'info@novastarmontessori.com',
        socialLinks: { facebook: 'https://facebook.com/novastarmontessori', twitter: 'https://twitter.com/novastarmont', instagram: 'https://instagram.com/novastarmontessori' },
      },
    })
  } else {
    await prisma.branding.create({
      data: {
        tenantId: tenant.id,
        schoolId: school.id,
        name: 'Novastar Montessori School',
        primaryColor: '#059669',
        secondaryColor: '#0891b2',
        accentColor: '#d97706',
        motto: 'Bringing quality care and experience to learning',
        address: 'Ayeduase New Site, K-5 Junction, Ayeduase Road, Kumasi, Ashanti Region, Ghana',
        phone: '+233 24 493 5251',
        email: 'info@novastarmontessori.com',
        socialLinks: { facebook: 'https://facebook.com/novastarmontessori', twitter: 'https://twitter.com/novastarmont', instagram: 'https://instagram.com/novastarmontessori' },
      },
    })
  }

  console.log('✅ Branding created')

  // ============ ADMISSIONS FLAG OVERRIDE ============
  // `SystemConfig` stores OVERRIDES ONLY. A row exists if and only if somebody
  // deliberately moved a flag away from its registry default, and the portal's
  // read path decides "Overridden" from the mere presence of a row — not from a
  // comparison against the default. `admissions_open` defaults to CLOSED, and
  // the 2026/27 intake is open, so without a row here a freshly seeded deployment
  // renders a site telling parents admissions are shut. Storing the difference is
  // the whole point; storing the default instead would be the mirror row the
  // write path refuses to create (`setFeatureFlag` deletes a row whose value IS
  // the default, because "no row" is the correct stored state there).
  //
  // `version` is set on both halves, against the portal's own write helper
  // (`writeOverrideRow` in apps/portal/lib/system-config.ts), because the token
  // has a fixed meaning: no row is 0, a created row is 1, every later write is the
  // previous value plus one, and a delete returns it to 0. A row created at the
  // column default of 0 would be indistinguishable from no row at all, so a tab
  // still holding precondition 0 — the number the read path publishes for "flag
  // nobody has ever overridden" — could overwrite this one outright. Incrementing
  // rather than assigning also repairs a legacy row already sitting at 0.
  //
  // `isEditable` is re-asserted rather than left to the column default: a seeded
  // row must not be able to arrive pre-locked, or the Head of School could not
  // close admissions for a later intake from Settings.
  const admissionsOpenOverride = {
    value: true,
    description: 'Admissions open for the 2026/27 intake',
    category: 'academics',
    isEditable: true,
  }

  await prisma.systemConfig.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: ADMISSIONS_OPEN_FLAG_KEY } },
    update: { ...admissionsOpenOverride, version: { increment: 1 } },
    create: { tenantId: tenant.id, key: ADMISSIONS_OPEN_FLAG_KEY, ...admissionsOpenOverride, version: 1 },
  })

  console.log('✅ Admissions flag override created (admissions_open = true — 2026/27 intake)')

  // ============ DEFAULT ADMIN USER ============
  const headmasterRole = await prisma.role.findFirst({ where: { tenantId: tenant.id, schoolId: school.id, name: 'HEADMASTER' } })
  if (!headmasterRole) {
    throw new Error('HEADMASTER role not found after seeding')
  }

  // Create corresponding StaffRole for the headmaster
  const headmasterStaffRole = await prisma.staffRole.upsert({
    where: { tenantId_schoolId_name: { tenantId: tenant.id, schoolId: school.id, name: 'HEADMASTER' } },
    update: {},
    create: {
      tenantId: tenant.id,
      schoolId: school.id,
      name: 'HEADMASTER',
      description: 'School Headmaster/Headmistress',
      baseRoleId: headmasterRole.id,
      permissions: headmasterRole.permissions,
    },
  })

  // Both passwords were resolved at the top of main(), where a missing variable
  // refuses the whole seed. There is no inline fallback left to reach for, which
  // is the point: the one place a password could become a committed literal is
  // the one place that no longer reads `process.env`.
  const passwordHash = await hashPassword(seedCredentials.headmasterPassword)

  // ============ THE TWO PORTAL ACCOUNTS: PROVISION ONCE, NEVER RE-CREDENTIAL ============
  // One rule, applied identically to both accounts below. The asymmetry was the
  // defect: the headmaster upsert had `update: {}` while the admin upsert
  // reassigned `passwordHash` on every run, so a single re-seed silently rotated
  // the password of whichever of the two somebody was most likely to have open in
  // a browser — with nothing in the output to say so. `roleId` and `isActive` stay
  // in the admin's update branch, because those are not credentials and letting
  // them go stale when a role is renamed or an account is suspended is its own
  // bug; but nothing in an update branch may touch a credential.
  //
  // WHY `mustChangePassword` IS NOT SET HERE, EVEN THOUGH EVERY OTHER WRITER SETS IT
  // `tools/tenant-cli/commands/user.ts:75,113`, `commands/operator.ts:208,236` and
  // `packages/auth/invite.ts:449` all set it, and the seed is the outlier. It is
  // deferred rather than rejected, because the flag is only safe on an account
  // that can finish the change it forces — and today it cannot:
  //
  //   * `apps/portal/proxy.ts:182-184` redirects every flagged session to
  //     `/set-password`. With no `token` in the query string that form renders
  //     "This page needs a setup link" and disables its submit button
  //     (`app/(auth)/set-password/set-password-form.tsx:119-126`).
  //   * `POST /api/auth/set-password` refuses to overwrite, so an invitation link
  //     would not rescue it either: an account that already holds a password gets
  //     409 `already-has-password` (`app/api/auth/set-password/route.ts:87-95`).
  //   * The documented way out is `/forgot-password`, which needs `RESEND_API_KEY`
  //     (unset; `.env.example:105`). That route catches the send failure and
  //     still answers 200 with "a reset link is on its way", so the operator is
  //     told the recovery worked while nothing was delivered.
  //
  // Seeding the flag now would therefore produce an account that can sign in,
  // cannot reach one page of the portal, and cannot recover — strictly worse than
  // the silent rotation it would fix, and harder to undo because the fix is a
  // direct column write. The dependency to watch is email delivery: once
  // `RESEND_API_KEY` and a verified sending domain exist, `/forgot-password` can
  // close the loop and this seed should set the flag on create, like the other
  // four writers. `tests/credentials.test.ts` fails if it is added before then.
  //
  // The re-credential path named in both log lines below is `novastar-tenant user
  // --rotate`. Worth knowing before using it on a deployment without email: that
  // flag also sets `mustChangePassword` (`commands/user.ts:75`), which lands the
  // account in exactly the state described above. With `RESEND_API_KEY` set the
  // flow completes normally; without it, the rotation leaves an account that can
  // sign in and then hits the redirect. The seed logs the command because it is
  // the sanctioned way to change a credential — not because the seed can enforce
  // the flag it needs, which is why the flag is absent here.

  // Only set password on create, never on update (re-seed should not reset credentials)
  const adminUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'headmaster@nms.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      schoolId: school.id,
      email: 'headmaster@nms.com',
      passwordHash,
      name: 'School Headmaster',
      roleId: headmasterRole.id,
      isActive: true,
    },
  })

  // ============ PORTAL ADMIN USER ============
  const adminPasswordHash = await hashPassword(seedCredentials.portalAdminPassword)
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@nms.com' } },
    // Credentials on create only, exactly as the headmaster above. This branch
    // used to set `passwordHash: adminPasswordHash`, so every re-seed silently
    // rotated the portal administrator's password back to the seeded value —
    // locking out whoever had changed it, and quietly undoing a real credential
    // change on a live environment.
    update: {
      roleId: headmasterRole.id,
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      schoolId: school.id,
      email: 'admin@nms.com',
      passwordHash: adminPasswordHash,
      name: 'Portal Administrator',
      roleId: headmasterRole.id,
      isActive: true,
    },
  })
  
  console.log(
    `✅ Portal admin user upserted (admin@nms.com) | ` +
      `password from ${seedCredentials.portalAdminSource}. This account's upsert does not apply password on update — ` +
      'where the account already existed the password above was NOT applied — only provisioning uses ' +
      'it. Re-credential this account with: ' +
      'novastar-tenant user --email admin@nms.com --rotate',
  )

  // ============ SUPER ADMIN OPERATOR ============
  // Create the super admin operator account for the platform console
  // Using a secure method: resolve from environment variables or fail
  const operatorPassword = process.env.PLATFORM_OPERATOR_PASSWORD
  if (!operatorPassword) {
    throw new Error(
      'Missing PLATFORM_OPERATOR_PASSWORD for super admin operator. ' +
      'Set this environment variable to create the sp@dev.com account for the platform console.',
    )
  }
  const operatorPasswordHash = await hashPassword(operatorPassword)
  
  await prisma.platformOperator.upsert({
    where: { email: 'sp@dev.com' },
    // Deliberately empty update: re-seeding must never rotate this credential.
    // The operator's password is created once from the CLI and held by a person
    // who already has the platform; silently changing it on every seed would
    // invalidate the one credential an operator depends on to reach the console.
    // Intentional rotation goes through `novastar-tenant operator --rotate`.
    update: {},
    create: {
      email: 'sp@dev.com',
      passwordHash: operatorPasswordHash,
      username: 'sp',
      name: 'Super Admin',
      capabilities: [
        'platform:read',
        'platform:audit', 
        'tenant:read',
        'tenant:update',
        'tenant:provision',
        'tenant:config',
        'tenant:user:read',
        'tenant:user:create',
      ],
      status: UserStatus.ACTIVE,
    },
  })
  
  console.log(
    `✅ Super Admin operator upserted (sp@dev.com) | ` +
      `password from PLATFORM_OPERATOR_PASSWORD. This account's upsert updates password if exists — ` +
      'creating the platform console super admin credential. Re-credential with: ' +
      'novastar-tenant operator --email sp@dev.com --rotate',
  )

  // Use transaction to ensure role FK is visible
  await prisma.$transaction(async (tx) => {
    const existingStaff = await tx.staff.findFirst({
      where: { tenantId: tenant.id, schoolId: school.id, employeeId: 'HM001' }
    })

    if (existingStaff) {
      await tx.staff.update({
        where: { id: existingStaff.id },
        data: {
          tenantId: tenant.id,
          schoolId: school.id,
          userId: adminUser.id,
          employeeId: 'HM001',
          firstName: 'School',
          lastName: 'Headmaster',
          gender: Gender.MALE,
          phone: '+233 24 493 5251',
          email: 'headmaster@nms.com',
          hireDate: new Date('2016-01-01'),
          status: StaffStatus.ACTIVE,
          roleId: headmasterStaffRole.id,
        },
      })
    } else {
      await tx.staff.create({
        data: {
          tenantId: tenant.id,
          schoolId: school.id,
          userId: adminUser.id,
          employeeId: 'HM001',
          firstName: 'School',
          lastName: 'Headmaster',
          gender: Gender.MALE,
          phone: '+233 24 493 5251',
          email: 'headmaster@nms.com',
          hireDate: new Date('2016-01-01'),
          status: StaffStatus.ACTIVE,
          roleId: headmasterStaffRole.id,
        },
      })
    }
  })

  console.log(
    `✅ Headmaster user upserted (headmaster@nms.com) | ` +
      `password from ${seedCredentials.headmasterSource}. This account's upsert has update: {}, so ` +
      'where the account already existed the password above was NOT applied — only provisioning uses ' +
      'it. Re-credential this account with: ' +
      'novastar-tenant user --email headmaster@nms.com --rotate',
  )

  // ============ SAMPLE CLASSES ============
  const classData = [
    { name: 'Creche A', levelCode: 'CRECHE', stream: 'A' },
    { name: 'Nursery 1A', levelCode: 'NURSERY1', stream: 'A' },
    { name: 'Nursery 2A', levelCode: 'NURSERY2', stream: 'A' },
    { name: 'KG 1A', levelCode: 'KG1', stream: 'A' },
    { name: 'KG 2A', levelCode: 'KG2', stream: 'A' },
    { name: 'Basic 1A', levelCode: 'B1', stream: 'A' },
    { name: 'Basic 2A', levelCode: 'B2', stream: 'A' },
    { name: 'Basic 3A', levelCode: 'B3', stream: 'A' },
    { name: 'Basic 4A', levelCode: 'B4', stream: 'A' },
    { name: 'Basic 5A', levelCode: 'B5', stream: 'A' },
    { name: 'Basic 6A', levelCode: 'B6', stream: 'A' },
    { name: 'JHS 1A', levelCode: 'B7', stream: 'A' },
    { name: 'JHS 2A', levelCode: 'B8', stream: 'A' },
    { name: 'JHS 3A', levelCode: 'B9', stream: 'A' },
  ]

  for (const c of classData) {
    const level = await prisma.classLevel.findUnique({ where: { tenantId_schoolId_code: { tenantId: tenant.id, schoolId: school.id, code: c.levelCode } } })
    if (level) {
      await prisma.class.upsert({
        where: { tenantId_schoolId_name_levelId: { tenantId: tenant.id, schoolId: school.id, name: c.name, levelId: level.id } },
        update: {},
        create: {
          tenantId: tenant.id,
          schoolId: school.id,
          name: c.name,
          levelId: level.id,
          stream: c.stream,
          capacity: 35,
        },
      })
    }
  }

  console.log('✅ Classes created (14 classes)')

  // ============ HOUSES ============
  const houses = [
    { name: 'Unity', color: '#16a34a', motto: 'Together we achieve', tenantId: tenant.id, schoolId: school.id },
    { name: 'Excellence', color: '#2563eb', motto: 'Strive for the best', tenantId: tenant.id, schoolId: school.id },
    { name: 'Integrity', color: '#dc2626', motto: 'Honesty above all', tenantId: tenant.id, schoolId: school.id },
    { name: 'Creativity', color: '#d97706', motto: 'Imagine and innovate', tenantId: tenant.id, schoolId: school.id },
  ]

  for (const h of houses) {
    await prisma.house.upsert({
      where: { tenantId_schoolId_name: { tenantId: tenant.id, schoolId: school.id, name: h.name } },
      update: {},
      create: h,
    })
  }

  console.log('✅ Houses created')

  // ============ DEPARTMENTS ============
  const departments = [
    { name: 'Academic Affairs', code: 'ACAD', tenantId: tenant.id, schoolId: school.id },
    { name: 'Administration', code: 'ADMIN', tenantId: tenant.id, schoolId: school.id },
    { name: 'Finance & Accounts', code: 'FIN', tenantId: tenant.id, schoolId: school.id },
    { name: 'Student Affairs', code: 'STU', tenantId: tenant.id, schoolId: school.id },
    { name: 'Facilities & Maintenance', code: 'FAC', tenantId: tenant.id, schoolId: school.id },
  ]

  for (const d of departments) {
    await prisma.department.upsert({
      where: { tenantId_schoolId_code: { tenantId: tenant.id, schoolId: school.id, code: d.code } },
      update: {},
      create: d,
    })
  }

  console.log('✅ Departments created')

  // ============ SAMPLE NEWS & EVENTS ============
  await prisma.news.upsert({
    where: { tenantId_schoolId_slug: { tenantId: tenant.id, schoolId: school.id, slug: 'welcome-2026-2027' } },
    update: {},
    create: {
      tenantId: tenant.id,
      schoolId: school.id,
      title: 'Welcome to the 2026/2027 Academic Year',
      slug: 'welcome-2026-2027',
      bodyEn: 'We are delighted to welcome all our students, parents, and staff to the new academic year. Term 1 begins on September 1st, 2026. Our Montessori programs continue to provide authentic child-centered education combined with Ghana Education Service standards.',
      bodyTw: 'Yɛnhyia mo paaara ma 2026/2027 kurasu no. Term 1 bɛda September 1, 2026. Yɛ Montessori adwumayɛ no nso yɛda wɔ ho.',
      excerptEn: 'Welcome to the new academic year at Novastar Montessori School.',
      category: 'Announcement',
      featuredImage: '/images/welcome-2026.jpg',
      audience: ['parents', 'staff', 'students'],
      status: ContentStatus.PUBLISHED,
      publishedAt: new Date('2026-08-15'),
      authorId: adminUser.id,
    },
  })

  // Open Day event
  const existingOpenDay = await prisma.event.findFirst({
    where: { tenantId: tenant.id, schoolId: school.id, title: 'Open Day', startDate: new Date('2026-09-15') }
  })
  if (existingOpenDay) {
    await prisma.event.update({
      where: { id: existingOpenDay.id },
      data: {
        tenantId: tenant.id,
        schoolId: school.id,
        title: 'Open Day & Parent Orientation',
        descriptionEn: 'Join us for our annual Open Day. Meet teachers, tour classrooms, and learn about our Montessori curriculum.',
        descriptionTw: 'Bra yɛn Open Day no ho. Nya abuafo, hwɛ klas, na nnim Montessori adwumayɛ no.',
        startDate: new Date('2026-09-15T09:00:00'),
        endDate: new Date('2026-09-15T14:00:00'),
        location: 'School Assembly Hall',
        audience: ['parents', 'staff'],
        isAllDay: false,
        status: ContentStatus.PUBLISHED,
      },
    })
  } else {
    await prisma.event.create({
      data: {
        tenantId: tenant.id,
        schoolId: school.id,
        title: 'Open Day & Parent Orientation',
        descriptionEn: 'Join us for our annual Open Day. Meet teachers, tour classrooms, and learn about our Montessori curriculum.',
        descriptionTw: 'Bra yɛn Open Day no ho. Nya abuafo, hwɛ klas, na nnim Montessori adwumayɛ no.',
        startDate: new Date('2026-09-15T09:00:00'),
        endDate: new Date('2026-09-15T14:00:00'),
        location: 'School Assembly Hall',
        audience: ['parents', 'staff'],
        isAllDay: false,
        status: ContentStatus.PUBLISHED,
      },
    })
  }

  // BECE Registration event
  const existingBece = await prisma.event.findFirst({
    where: { tenantId: tenant.id, schoolId: school.id, title: 'BECE Registration', startDate: new Date('2026-10-01') }
  })
  if (existingBece) {
    await prisma.event.update({
      where: { id: existingBece.id },
      data: {
        tenantId: tenant.id,
        schoolId: school.id,
        title: 'BECE Registration Opens',
        descriptionEn: 'Registration for the Basic Education Certificate Examination (BECE) 2027 opens today. JHS 3 parents should complete forms by October 31.',
        descriptionTw: 'BECE 2027 daakye no adaa yɛ so. JHS 3 mma no papafo yɛ daakye akyerɛw no anaa da October 31.',
        startDate: new Date('2026-10-01'),
        endDate: new Date('2026-10-31'),
        isAllDay: true,
        audience: ['parents', 'staff', 'students'],
        status: ContentStatus.PUBLISHED,
      },
    })
  } else {
    await prisma.event.create({
      data: {
        tenantId: tenant.id,
        schoolId: school.id,
        title: 'BECE Registration Opens',
        descriptionEn: 'Registration for the Basic Education Certificate Examination (BECE) 2027 opens today. JHS 3 parents should complete forms by October 31.',
        descriptionTw: 'BECE 2027 daakye no adaa yɛ so. JHS 3 mma no papafo yɛ daakye akyerɛw no anaa da October 31.',
        startDate: new Date('2026-10-01'),
        endDate: new Date('2026-10-31'),
        isAllDay: true,
        audience: ['parents', 'staff', 'students'],
        status: ContentStatus.PUBLISHED,
      },
    })
  }

  console.log('✅ News & Events created')

  console.log('\n🎉 Seed completed successfully!')
  console.log('\n📋 Summary:')
  console.log('  • 1 Tenant (Novastar)')
  console.log('  • 1 School (Main campus)')
  console.log('  • 2 Academic Years (2025/26, 2026/27)')
  console.log('  • 3 Terms per year')
  console.log('  • 14 Class Levels (Creche → JHS 3)')
  console.log('  • 19 Subjects (GES + Montessori)')
  console.log('  • 2 Grading Scale templates (Ghana Primary GES 6-level, Ghana JHS BECE 1-9) — editable, not policy')
  console.log('  • 7 Assessment Types (SBA, exams, coursework) — relative weights summing to 1.00')
  console.log('  • 9 Fee Categories + 6 Payment Methods (MoMo, Bank, Cash)')
  console.log('  • 5 Fee Structures')
  console.log('  • 7 Roles + 28 Permissions')
  console.log('  • 1 Branding config')
  console.log('  • 1 SystemConfig override (admissions_open = true — 2026/27 intake; the registry default is closed)')
  console.log('  • 1 Admin User (headmaster@nms.com)')
  console.log('  • 14 Classes')
  console.log('  • 4 Houses + 5 Departments')
  console.log('  • Sample News & Events')
}

main()
  .catch((e) => {
    // A refusal prints its own message and nothing else. `console.error('…', e)`
    // would append the stack, and the message already says which variable is
    // missing and how to set it — a stack trace under an actionable sentence
    // only buries it.
    if (e instanceof SeedCredentialsError) {
      console.error(e.message)
    } else {
      console.error('❌ Seed failed:', e)
    }
    // `exitCode`, not `exit`, so `.finally` still runs and the Prisma adapter is
    // disconnected. A caller checking the status sees a failure either way, which
    // is the half that matters: a refused seed that reported success would leave
    // a CI step convinced the database was seeded.
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
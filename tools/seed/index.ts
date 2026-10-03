#!/usr/bin/env bun
// Seed script — Populates database with Ghana/NaCCA baseline data
// Run with: bun run seed/index.ts (after DATABASE_URL is set)

import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { PERMISSION_CATALOG, permissionsForRole } from '@novastar/shared-types'
import { Phase, SubjectCategory, TermStatus, Gender, StaffStatus, StudentStatus, AttendanceStatus, InvoiceStatus, PaymentStatus, MessageChannel, MessageStatus, NotificationType, ContentStatus, ReportType, LeaveType, LeaveStatus } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

// Load .env from project root
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

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('❌ DATABASE_URL not set in environment')
  console.error('   Create .env in project root with: DATABASE_URL="postgresql://..."')
  process.exit(1)
}

const adapter = new PrismaNeon({ connectionString })
const prisma = new PrismaClient({ adapter })

async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password, { algorithm: 'argon2id' })
}

async function main() {
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

  const prevYear = await prisma.academicYear.upsert({
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

  const term2 = await prisma.term.upsert({
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

  const term3 = await prisma.term.upsert({
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

  // ============ GRADING SCALES (GES Standard) ============
  const existingGesScale = await prisma.gradingScale.findFirst({
    where: { tenantId: tenant.id, schoolId: school.id, name: 'GES Standard (A-F)' }
  })

  const gesScale = existingGesScale
    ? await prisma.gradingScale.update({
        where: { id: existingGesScale.id },
        data: {
          description: 'Ghana Education Service standard grading scale used for BECE and national exams',
          isDefault: true,
          appliesToLevels: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9'],
          levels: {
            deleteMany: {},
            create: [
              { key: 'A', label: 'A (Excellent)', minScore: 80, maxScore: 100, color: '#16a34a', order: 1, description: 'Excellent understanding' },
              { key: 'B', label: 'B (Very Good)', minScore: 70, maxScore: 79, color: '#22c55e', order: 2, description: 'Very good understanding' },
              { key: 'C', label: 'C (Good)', minScore: 60, maxScore: 69, color: '#eab308', order: 3, description: 'Good understanding' },
              { key: 'D', label: 'D (Pass)', minScore: 50, maxScore: 59, color: '#f97316', order: 4, description: 'Pass' },
              { key: 'E', label: 'E (Weak Pass)', minScore: 40, maxScore: 49, color: '#f43f5e', order: 5, description: 'Weak pass' },
              { key: 'F', label: 'F (Fail)', minScore: 0, maxScore: 39, color: '#ef4444', order: 6, description: 'Fail' },
            ],
          },
        },
      })
    : await prisma.gradingScale.create({
        data: {
          tenantId: tenant.id,
          schoolId: school.id,
          name: 'GES Standard (A-F)',
          description: 'Ghana Education Service standard grading scale used for BECE and national exams',
          isDefault: true,
          appliesToLevels: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9'],
          levels: {
            create: [
              { key: 'A', label: 'A (Excellent)', minScore: 80, maxScore: 100, color: '#16a34a', order: 1, description: 'Excellent understanding' },
              { key: 'B', label: 'B (Very Good)', minScore: 70, maxScore: 79, color: '#22c55e', order: 2, description: 'Very good understanding' },
              { key: 'C', label: 'C (Good)', minScore: 60, maxScore: 69, color: '#eab308', order: 3, description: 'Good understanding' },
              { key: 'D', label: 'D (Pass)', minScore: 50, maxScore: 59, color: '#f97316', order: 4, description: 'Pass' },
              { key: 'E', label: 'E (Weak Pass)', minScore: 40, maxScore: 49, color: '#f43f5e', order: 5, description: 'Weak pass' },
              { key: 'F', label: 'F (Fail)', minScore: 0, maxScore: 39, color: '#ef4444', order: 6, description: 'Fail' },
            ],
          },
        },
      })

  const existingMontessoriScale = await prisma.gradingScale.findFirst({
    where: { tenantId: tenant.id, schoolId: school.id, name: 'Montessori Observational' }
  })

  const montessoriScale = existingMontessoriScale
    ? await prisma.gradingScale.update({
        where: { id: existingMontessoriScale.id },
        data: {
          description: 'Narrative-based assessment for Montessori environments (Creche-KG2)',
          isDefault: false,
          appliesToLevels: ['CRECHE', 'NURSERY1', 'NURSERY2', 'KG1', 'KG2'],
          levels: {
            deleteMany: {},
            create: [
              { key: 'EXEMPLARY', label: 'Exemplary', minScore: 90, maxScore: 100, color: '#16a34a', order: 1, description: 'Exceeds expectations independently' },
              { key: 'PROFICIENT', label: 'Proficient', minScore: 75, maxScore: 89, color: '#22c55e', order: 2, description: 'Meets expectations independently' },
              { key: 'DEVELOPING', label: 'Developing', minScore: 60, maxScore: 74, color: '#eab308', order: 3, description: 'Progressing with guidance' },
              { key: 'EMERGING', label: 'Emerging', minScore: 0, maxScore: 59, color: '#f43f5e', order: 4, description: 'Beginning to show understanding' },
            ],
          },
        },
      })
    : await prisma.gradingScale.create({
        data: {
          tenantId: tenant.id,
          schoolId: school.id,
          name: 'Montessori Observational',
          description: 'Narrative-based assessment for Montessori environments (Creche-KG2)',
          isDefault: false,
          appliesToLevels: ['CRECHE', 'NURSERY1', 'NURSERY2', 'KG1', 'KG2'],
          levels: {
            create: [
              { key: 'EXEMPLARY', label: 'Exemplary', minScore: 90, maxScore: 100, color: '#16a34a', order: 1, description: 'Exceeds expectations independently' },
              { key: 'PROFICIENT', label: 'Proficient', minScore: 75, maxScore: 89, color: '#22c55e', order: 2, description: 'Meets expectations independently' },
              { key: 'DEVELOPING', label: 'Developing', minScore: 60, maxScore: 74, color: '#eab308', order: 3, description: 'Progressing with guidance' },
              { key: 'EMERGING', label: 'Emerging', minScore: 0, maxScore: 59, color: '#f43f5e', order: 4, description: 'Beginning to show understanding' },
            ],
          },
        },
      })

  console.log('✅ Grading Scales created')

  // ============ ASSESSMENT TYPES ============
  const assessmentTypes = [
    { code: 'CLASSWORK', name: 'Classwork', defaultWeight: 0.20, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
    { code: 'HOMEWORK', name: 'Homework', defaultWeight: 0.10, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
    { code: 'QUIZ', name: 'Quiz', defaultWeight: 0.15, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
    { code: 'PROJECT', name: 'Project', defaultWeight: 0.15, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
    { code: 'MIDTERM', name: 'Midterm Exam', defaultWeight: 0.20, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
    { code: 'FINAL', name: 'Final Exam', defaultWeight: 0.20, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
    { code: 'SBA', name: 'School-Based Assessment', defaultWeight: 0.30, maxScore: 100, tenantId: tenant.id, schoolId: school.id },
  ]

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

  const headmasterPassword = process.env.SEED_HEADMASTER_PASSWORD
  if (!headmasterPassword) {
    console.warn('WARNING: SEED_HEADMASTER_PASSWORD not set — using default that must be changed after first login.')
  }
  const passwordHash = await hashPassword(headmasterPassword || 'Novastar2026!')

  // Only set password on create, never on update (re-seed should not reset credentials)
  const adminUser = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'headmaster@novastarmontessori.com' } },
    update: {},
    create: {
      tenantId: tenant.id,
      schoolId: school.id,
      email: 'headmaster@novastarmontessori.com',
      passwordHash,
      name: 'School Headmaster',
      roleId: headmasterRole.id,
      isActive: true,
    },
  })

  // ============ PORTAL ADMIN USER ============
  const portalAdminPassword = process.env.SEED_PORTAL_ADMIN_PASSWORD
  if (!portalAdminPassword) {
    console.warn('WARNING: SEED_PORTAL_ADMIN_PASSWORD not set — using default that must be changed after first login.')
  }
  const adminPasswordHash = await hashPassword(portalAdminPassword || 'Admin@2026')
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@novastarmontessori.com' } },
    update: {
      passwordHash: adminPasswordHash,
      roleId: headmasterRole.id,
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      schoolId: school.id,
      email: 'admin@novastarmontessori.com',
      passwordHash: adminPasswordHash,
      name: 'Portal Administrator',
      roleId: headmasterRole.id,
      isActive: true,
    },
  })
  console.log('✅ Portal Admin user created (admin@novastarmontessori.com / set via SEED_PORTAL_ADMIN_PASSWORD)')

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
          email: 'headmaster@novastarmontessori.com',
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
          email: 'headmaster@novastarmontessori.com',
          hireDate: new Date('2016-01-01'),
          status: StaffStatus.ACTIVE,
          roleId: headmasterStaffRole.id,
        },
      })
    }
  })

  console.log('✅ Headmaster user upserted (headmaster@novastarmontessori.com) | set SEED_HEADMASTER_PASSWORD before first seed to provision initial credential')

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
  console.log('  • 2 Grading Scales (GES A-F, Montessori Observational)')
  console.log('  • 7 Assessment Types (SBA, exams, coursework)')
  console.log('  • 9 Fee Categories + 6 Payment Methods (MoMo, Bank, Cash)')
  console.log('  • 5 Fee Structures')
  console.log('  • 7 Roles + 28 Permissions')
  console.log('  • 1 Branding config')
  console.log('  • 1 Admin User (headmaster@novastarmontessori.com)')
  console.log('  • 14 Classes')
  console.log('  • 4 Houses + 5 Departments')
  console.log('  • Sample News & Events')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
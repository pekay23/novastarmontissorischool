// ============================================================================
// Ghana Education Service (GES/NaCCA) Curriculum Engine
// ============================================================================

import type { Phase } from '@novastar/shared-types'
import { eachDayOfInterval, isWeekend } from 'date-fns'

// --- NaCCA Key Learning Areas (KLA) by Phase ---

export interface CurriculumSubject {
  code: string
  name: string
  category: 'core' | 'elective' | 'montessori'
  isCore: boolean
  creditHours?: number
  description?: string
}

export interface PhaseCurriculum {
  phase: Phase
  phases: string[]
  subjects: CurriculumSubject[]
  assessmentTypes: string[]
  gradingScale: string
  description: string
}

// NaCCA Standard Curriculum (2026) — fully configurable via admin UI
export const GES_CURRICULUM: Record<Phase, PhaseCurriculum> = {
  KINDERGARTEN: {
    phase: 'KINDERGARTEN',
    phases: ['KG1', 'KG2'],
    subjects: [
      { code: 'KG_LANGUAGES', name: 'Language Literacy', category: 'core', isCore: true, description: 'English, Twi, foundational literacy' },
      { code: 'KG_NUMERACY', name: 'Numeracy', category: 'core', isCore: true, description: 'Numbers, shapes, patterns' },
      { code: 'KG_SENSORIAL', name: 'Sensorial Activities', category: 'montessori', isCore: true, description: 'Sorting, grading, awareness exercises' },
      { code: 'KG_PRACTICAL', name: 'Practical Life', category: 'montessori', isCore: true, description: 'Daily living skills, grace & courtesy' },
      { code: 'KG_CULTURAL', name: 'Cultural Activities', category: 'montessori', isCore: true, description: 'Music, art, nature, geography' },
      { code: 'KG_PHYSED', name: 'Physical Development', category: 'core', isCore: true, description: 'Gross/fine motor, health, safety' },
    ],
    assessmentTypes: ['obs'],
    gradingScale: 'naCCA_EYLF',
    description: 'NaCCA Early Year Development Standards (Birth-5 years)',
  },
  PRIMARY: {
    phase: 'PRIMARY',
    phases: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'],
    subjects: [
      { code: 'ENG', name: 'English', category: 'core', isCore: true },
      { code: 'GLO', name: 'Ghanaian Language', category: 'core', isCore: true, description: 'Akan, Ewe, Ga, Dagbani' },
      { code: 'MAT', name: 'Mathematics', category: 'core', isCore: true },
      { code: 'SCI', name: 'Integrated Science', category: 'core', isCore: true },
      { code: 'SST', name: 'Social Studies', category: 'core', isCore: true },
      { code: 'RME', name: 'Religious & Moral Education', category: 'core', isCore: true },
      { code: 'CULT', name: 'Creative Arts', category: 'core', isCore: true, description: 'Visual Art, Music, Drama' },
      { code: 'PHE', name: 'Physical Education', category: 'core', isCore: true },
      { code: 'ICT', name: 'Information & Communication Technology', category: 'core', isCore: true },
      { code: 'MON_LC', name: 'Montessori Language', category: 'montessori', isCore: false },
      { code: 'MON_MATH', name: 'Montessori Mathematics', category: 'montessori', isCore: false },
    ],
    assessmentTypes: ['sba1', 'sba2', 'sba3', 'midterm', 'terminal'],
    gradingScale: 'naCCA_6_1',
    description: 'NaCCA Lower & Upper Primary (B1-B6)',
  },
  JHS: {
    phase: 'JHS',
    phases: ['B7', 'B8', 'B9'],
    subjects: [
      { code: 'ENG', name: 'English Language', category: 'core', isCore: true },
      { code: 'GLO', name: 'Ghanaian Language', category: 'core', isCore: true },
      { code: 'MAT', name: 'Mathematics', category: 'core', isCore: true },
      { code: 'SCI', name: 'Integrated Science', category: 'core', isCore: true },
      { code: 'SST', name: 'Social Studies', category: 'core', isCore: true },
      { code: 'RME', name: 'Religious & Moral Education', category: 'core', isCore: true },
      { code: 'CULT', name: 'Creative Arts', category: 'core', isCore: true },
      { code: 'PHE', name: 'Physical Education', category: 'core', isCore: true },
      { code: 'ICT', name: 'Information & Communication Technology', category: 'core', isCore: true },
      { code: 'FRENCH', name: 'French', category: 'elective', isCore: false },
      { code: 'AGRIC', name: 'Agricultural Science', category: 'elective', isCore: false },
      { code: 'BST', name: 'Business Studies', category: 'elective', isCore: false },
    ],
    assessmentTypes: ['sba1', 'sba2', 'sba3', 'blc', 'midterm', 'terminal', 'mock'],
    gradingScale: 'naCCA_6_1',
    description: 'Junior High School (JHS 1-3) — Common Core Programme',
  },
  SHS: {
    phase: 'SHS',
    phases: ['B10', 'B11', 'B12'],
    subjects: [
      { code: 'ENG', name: 'English Language', category: 'core', isCore: true },
      { code: 'MAT', name: 'Mathematics', category: 'core', isCore: true },
      { code: 'GLO', name: 'Ghanaian Language', category: 'core', isCore: true },
      { code: 'ICT', name: 'Information & Communication Technology', category: 'core', isCore: true },
      { code: 'RME', name: 'Religious & Moral Education', category: 'core', isCore: true },
      { code: 'PHE', name: 'Physical Education', category: 'core', isCore: true },
      { code: 'CULT', name: 'Creative Arts', category: 'core', isCore: true },
      { code: 'SST', name: 'Social Studies', category: 'elective', isCore: false },
      { code: 'SCI', name: 'Science', category: 'elective', isCore: false },
      { code: 'MATH', name: 'Elective Mathematics', category: 'elective', isCore: false },
      { code: 'FRENCH', name: 'French', category: 'elective', isCore: false },
    ],
    assessmentTypes: ['sba1', 'sba2', 'sba3', 'midterm', 'terminal', 'mock'],
    gradingScale: 'naCCA_5_1',
    description: 'Senior High School (SHS 1-3) — per track choice',
  },
}

// --- NaCCA Standard Grading Scales ---

export interface GradingLevelConfig {
  key: string
  label: string
  minScore: number
  maxScore: number
  color: string
  description?: string
}

export interface GradingScale {
  id: string
  name: string
  levels: GradingLevelConfig[]
}

// NaCCA 6-Level (JHS/SHS): 1-6 scale
export const NACCA_6_LEVEL: GradingScale = {
  id: 'nacca_6_level',
  name: 'NaCCA 6-Level Scale (1-6)',
  levels: [
    { key: 'level1', label: 'Level 1 — Below Partial', minScore: 0, maxScore: 39, color: '#dc2626', description: 'Significantly below expected standard' },
    { key: 'level2', label: 'Level 2 — Partial', minScore: 40, maxScore: 49, color: '#ea580c', description: 'Below expected standard' },
    { key: 'level3', label: 'Level 3 — Elementary', minScore: 50, maxScore: 59, color: '#d97706', description: 'At elementary standard' },
    { key: 'level4', label: 'Level 4 — Adequate', minScore: 60, maxScore: 69, color: '#eab308', description: 'At adequate standard' },
    { key: 'level5', label: 'Level 5 — Proficient', minScore: 70, maxScore: 84, color: '#0891b3', description: 'At proficient standard' },
    { key: 'level6', label: 'Level 6 — Excellent', minScore: 85, maxScore: 100, color: '#059669', description: 'At excellent standard' },
  ],
}

// NaCCA 5-Level (SHS): A-G scale
export const NACCA_5_LEVEL: GradingScale = {
  id: 'nacca_5_level',
  name: 'NaCCA 5-Level Scale (A-G)',
  levels: [
    { key: 'A1', label: 'A1 (80-100%)', minScore: 80, maxScore: 100, color: '#059669', description: 'Excellent' },
    { key: 'B2', label: 'B2 (70-79%)', minScore: 70, maxScore: 79, color: '#0891b3', description: 'Very Good' },
    { key: 'B3', label: 'B3 (65-69%)', minScore: 65, maxScore: 69, color: '#1d9ed9', description: 'Good' },
    { key: 'C4', label: 'C4 (60-64%)', minScore: 60, maxScore: 64, color: '#38bdf8', description: 'Average' },
    { key: 'C5', label: 'C5 (55-59%)', minScore: 55, maxScore: 59, color: '#7dd3fc', description: 'Average' },
    { key: 'C6', label: 'C6 (50-54%)', minScore: 50, maxScore: 54, color: '#bae6fd', description: 'Lower Average' },
    { key: 'D7', label: 'D7 (45-49%)', minScore: 45, maxScore: 49, color: '#f59e0b', description: 'Weak' },
    { key: 'E8', label: 'E8 (40-44%)', minScore: 40, maxScore: 44, color: '#f97316', description: 'Very Weak' },
    { key: 'F9', label: 'F9 (0-39%)', minScore: 0, maxScore: 39, color: '#dc2626', description: 'Fail' },
  ],
}

// Montessori Standards-Based
export const MONTESSORI_GRADING: GradingScale = {
  id: 'montessori_grading',
  name: 'Montessori Standards-Based',
  levels: [
    { key: 'exemplary', label: 'Exemplary', minScore: 80, maxScore: 100, color: '#059669', description: 'Exceeds expectations consistently' },
    { key: 'proficient', label: 'Proficient', minScore: 65, maxScore: 79, color: '#0891b3', description: 'Meets expectations independently' },
    { key: 'developing', label: 'Developing', minScore: 50, maxScore: 64, color: '#d97706', description: 'Approaching expectations with support' },
    { key: 'emerging', label: 'Emerging', minScore: 0, maxScore: 49, color: '#dc2626', description: 'Not yet meeting expectations' },
  ],
}

// EYLF (Early Years): 1-5
export const EYLF_GRADING: GradingScale = {
  id: 'eylf_grading',
  name: 'Early Years Learning Framework (1-5)',
  levels: [
    { key: 'exceeding', label: 'Exceeding', minScore: 80, maxScore: 100, color: '#059669', description: 'Exceeding the Early Years Learning Outcomes' },
    { key: 'proficient', label: 'Proficient', minScore: 60, maxScore: 79, color: '#0891b3', description: 'Achieving the Early Years Learning Outcomes' },
    { key: 'progressing', label: 'Progressing', minScore: 40, maxScore: 59, color: '#d97706', description: 'Developing the Early Years Learning Outcomes' },
    { key: 'emerging', label: 'Emerging', minScore: 20, maxScore: 39, color: '#f59e0b', description: 'Beginning the Early Years Learning Outcomes' },
    { key: 'not_yet', label: 'Not Yet', minScore: 0, maxScore: 19, color: '#dc2626', description: 'Not yet demonstrating the Early Years Learning Outcomes' },
  ],
}

// --- Promotion Rules (NaCCA-based defaults) ---

export interface PromotionRule {
  condition: string
  minAverage: number
  minAttendance: number
  minSBA: number
  requiresEnglishPass: boolean
  requiresMathPass: boolean
}

// Default: JHS promotion (NaCCA requires 40% overall, 35% in English & Math)
export const DEFAULT_JHS_PROMOTION: PromotionRule = {
  condition: 'JHS_END_OF_YEAR',
  minAverage: 40,
  minAttendance: 80,
  minSBA: 40,
  requiresEnglishPass: true,
  requiresMathPass: true,
}

// Default: Primary promotion (passes core subjects)
export const DEFAULT_PRIMARY_PROMOTION: PromotionRule = {
  condition: 'PRIMARY_END_OF_YEAR',
  minAverage: 40,
  minAttendance: 80,
  minSBA: 40,
  requiresEnglishPass: true,
  requiresMathPass: true,
}

// --- Term Dates Calculator (Ghana standard) ---

export interface TermDates {
  term1: { start: Date; end: Date }
  term2: { start: Date; end: Date }
  term3: { start: Date; end: Date }
  holidays: { start: Date; end: Date }
}

/**
 * Calculate standard Ghana school term dates for a given academic year.
 * Term 1: Sept – Dec
 * Term 2: Jan – Apr
 * Term 3: May – Aug
 * Long vacation: Aug – Sept
 */
export function calculateGhanaTermDates(academicYearStart: Date): TermDates {
  const year = academicYearStart.getFullYear()
  
  return {
    term1: {
      start: new Date(year, 8, 1),   // Sept 1
      end: new Date(year, 11, 20),   // Dec 20
    },
    term2: {
      start: new Date(year + 1, 0, 6),  // Jan 6
      end: new Date(year + 1, 3, 16),   // Apr 16
    },
    term3: {
      start: new Date(year + 1, 4, 2),  // May 2
      end: new Date(year + 1, 7, 15),   // Aug 15
    },
    holidays: {
      start: new Date(year + 1, 7, 15),  // Aug 15
      // Day 1, not 31. Month 8 is September, which has 30 days, so `8, 31`
      // rolls forward to October 1 and made the long vacation 17 days longer
      // than the "Aug – Sept" above. `calculateTeachingDays` treats both ends
      // as inclusive, so the extra window silently added 30 days to every
      // academic year's teaching total — the kind of number a fee or an
      // attendance report is built on.
      end: new Date(year + 1, 8, 1),   // Sept 1
    },
  }
}

// --- Assessment Windows (NaCCA standard) ---

export interface AssessmentWindow {
  name: string
  weeksFromTermStart: number
  duration: number       // days
  isMandatory: boolean
}

export const DEFAULT_ASSESSMENT_WINDOWS: Record<string, AssessmentWindow[]> = {
  primary: [
    { name: 'SBA 1', weeksFromTermStart: 3, duration: 5, isMandatory: true },
    { name: 'Mid-Term', weeksFromTermStart: 7, duration: 3, isMandatory: true },
    { name: 'SBA 2', weeksFromTermStart: 10, duration: 5, isMandatory: true },
    { name: 'SBA 3', weeksFromTermStart: 13, duration: 5, isMandatory: true },
    { name: 'Terminal', weeksFromTermStart: 14, duration: 3, isMandatory: true },
  ],
  jhs: [
    { name: 'SBA 1', weeksFromTermStart: 3, duration: 7, isMandatory: true },
    { name: 'BLC/Mid-Term', weeksFromTermStart: 7, duration: 3, isMandatory: true },
    { name: 'SBA 2', weeksFromTermStart: 10, duration: 7, isMandatory: true },
    { name: 'SBA 3', weeksFromTermStart: 13, duration: 5, isMandatory: true },
    { name: 'Terminal', weeksFromTermStart: 14, duration: 3, isMandatory: true },
  ],
  shs: [
    { name: 'Coursework', weeksFromTermStart: 5, duration: 7, isMandatory: true },
    { name: 'Mid-Term', weeksFromTermStart: 8, duration: 3, isMandatory: true },
    { name: 'Coursework 2', weeksFromTermStart: 11, duration: 5, isMandatory: true },
    { name: 'Mock', weeksFromTermStart: 13, duration: 2, isMandatory: true },
    { name: 'Terminal', weeksFromTermStart: 14, duration: 3, isMandatory: true },
  ],
}

// --- Teaching Weeks Calculator ---

/**
 * Calculate actual teaching days (exclude weekends & holidays)
 */
export function calculateTeachingDays(
  termStart: Date,
  termEnd: Date,
  holidays: Array<{ start: Date; end: Date }> = []
): number {
  const allDays = eachDayOfInterval({ start: termStart, end: termEnd })
  
  // Filter out weekends
  const weekdays = allDays.filter(day => !isWeekend(day))
  
  // Filter out holidays
  let teachingDays = weekdays
  for (const holiday of holidays) {
    teachingDays = teachingDays.filter(day => day < holiday.start || day > holiday.end)
  }
  
  return teachingDays.length
}

// --- BECE WASSCE Subject Mapping ---

export const BECE_SUBJECT_MAPPING: Record<string, string> = {
  // JHS core subjects
  'ENG': 'English Language',
  'GLO': 'Ghanaian Language',
  'MAT': 'Mathematics',
  'SCI': 'Integrated Science',
  'SST': 'Social Studies',
  'RME': 'Religious & Moral Education',
  'ICT': 'Information Communication Technology',
  'PHE': 'Physical Education',
  'CULT': 'Creative Arts',
}

export const WASSCE_SUBJECT_MAPPING: Record<string, string> = {
  // SHS subjects
  'ENG': 'English Language',
  'MAT': 'Elective Mathematics',
  'SST': 'Social Studies',
  'SCI': 'Science (Biology, Chemistry, Physics)',
  'FRENCH': 'French',
  'ICT': 'Information Communication Technology',
  'RME': 'Religious & Moral Education',
}

// --- Report Card Templates (NaCCA compliant) ---

export interface ReportCardTemplate {
  id: string
  name: string
  phase: Phase
  sections: string[]
  includes: {
    attendance: boolean
    behavior: boolean
    coCurricular: boolean
    teacherComments: boolean
    principalComments: boolean
    promotionStatus: boolean
  }
}

export const DEFAULT_REPORT_TEMPLATES: ReportCardTemplate[] = [
  {
    id: 'primary_terminal_report',
    name: 'Primary Terminal Report Card',
    phase: 'PRIMARY',
    sections: ['Student Info', 'Subject Scores', 'Overall Performance', 'Attendance', 'Teacher Comments', 'Headmaster Comment', 'Promotion Status'],
    includes: {
      attendance: true,
      behavior: true,
      coCurricular: true,
      teacherComments: true,
      principalComments: true,
      promotionStatus: true,
    },
  },
  {
    id: 'jhs_terminal_report',
    name: 'JHS Terminal Report Card',
    phase: 'JHS',
    sections: ['Student Info', 'Subject Scores', 'SBA Scores', 'Overall Performance', 'Assessment Areas', 'Attendance', 'Behaviour', 'Teacher Comments', 'Head of School Comment', 'Promotion Status'],
    includes: {
      attendance: true,
      behavior: true,
      coCurricular: true,
      teacherComments: true,
      principalComments: true,
      promotionStatus: true,
    },
  },
  {
    id: 'shs_semester_report',
    name: 'SHS Semester Report Card',
    phase: 'SHS',
    sections: ['Student Info', 'Subject Scores', 'Coursework/SBA', 'Overall Performance', 'Grade Point Average', 'Attendance', 'Co-Curricular Activities', 'Teacher Comments', 'HOD Comment', 'Headmaster Comment'],
    includes: {
          attendance: true,
          behavior: true,
          coCurricular: true,
          teacherComments: true,
          principalComments: true,
          promotionStatus: false,
        },
      },
    ]
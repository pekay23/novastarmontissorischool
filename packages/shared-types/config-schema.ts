import { z } from 'zod'

// ============================================================================
// CONFIG SCHEMA — Defines all configurable entities as admin-editable
// This is the "control panel" schema that drives zero-hardcoding
// ============================================================================

// Generic Configurable Entity Template
export const ConfigurableEntitySchema = z.object({
  id: z.string().cuid(),
  key: z.string().min(1),    // system identifier (e.g., "math", "kg1")
  name: z.string().min(1),   // display name editable by admin
  description: z.string().nullable().optional(),
  isSystem: z.boolean().default(false),  // protected from deletion
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  metadata: z.record(z.string(), z.unknown()).default({}),  // custom fields per entity
  tenantId: z.string().cuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

// Entity Type Registry — defines what configurable entities exist
//
// Every `type` used by `DEFAULT_ENTITY_REGISTRY` MUST be a member of this enum.
// It was not: `class`, `fee_line_item`, `staff`, `student` and `parent` were in
// the registry but absent here, so `EntityRegistrySchema.parse(
// DEFAULT_ENTITY_REGISTRY)` failed and only the trailing `as EntityDefinition[]`
// cast on the registry hid it. An enum that does not contain the registry means
// a consumer narrowing on `EntityType` cannot name a managed entity.
// `EntityRegistrySchema.parse(DEFAULT_ENTITY_REGISTRY)` is pinned by a test in
// apps/portal/tests/assessment-config-weights.test.ts so the next added entry
// cannot silently reintroduce the gap.
export const EntityTypeSchema = z.enum([
  'academic_year',
  'term',
  'class_level',
  'class',
  'subject',
  'subject_level',
  'class_subject',
  'grading_scale',
  'grading_level',
  'assessment_type',
  'fee_category',
  'fee_structure',
  'fee_line_item',
  'payment_method',
  'role',
  'permission',
  'delegation_rule',
  'staff_role',
  'department',
  'house',
  'news',
  'event',
  'report_template',
  'branding',
  'attendance_rule',
  'promotion_rule',
  'attendance_taker',
  'communication_template',
  'staff',
  'student',
  'parent',
])

export type EntityType = z.infer<typeof EntityTypeSchema>

// Entity Field Definition — for dynamic form generation
export const EntityFieldSchema = z.object({
  key: z.string(),                  // field identifier
  label: z.string(),                // human-readable label
  type: z.enum(['string', 'text', 'number', 'boolean', 'date', 'datetime', 'select', 'multiselect', 'json', 'url', 'email', 'color']),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  validation: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    minItems: z.number().optional(),
    maxItems: z.number().optional(),
  }).optional(),
  options: z.array(z.object({
    value: z.string(),
    label: z.string(),
    color: z.string().optional(),
  })).optional(),
  default: z.unknown().optional(),
  group: z.string().optional(),    // section grouping in form
  order: z.number().int().default(0),
  isSystem: z.boolean().default(false),
  dependsOn: z.object({
    field: z.string(),
    value: z.string(),
  }).optional(),
  translatable: z.boolean().default(false), // i18n support
})

export type EntityField = z.infer<typeof EntityFieldSchema>

// Entity Definition — how each configurable entity is structured
export const EntityDefinitionSchema = z.object({
  type: EntityTypeSchema,
  name: z.string(),                 // human-friendly name
  namePlural: z.string(),           // plural form
  description: z.string(),
  icon: z.string().optional(),      // lucide icon name
  color: z.string().optional(),     // theme color for this entity section
  fields: z.array(EntityFieldSchema),
  allowAdd: z.boolean().default(true),
  allowEdit: z.boolean().default(true),
  allowDelete: z.boolean().default(true),
  allowImport: z.boolean().default(false),
  allowExport: z.boolean().default(true),
  defaultSortBy: z.string().optional(),
  defaultSortOrder: z.enum(['asc', 'desc']).default('asc'),
  searchFields: z.array(z.string()).optional(),
  filterFields: z.array(z.string()).optional(),
  groupBy: z.array(z.string()).optional(),
  hasPermissions: z.boolean().default(false),  // requires RBAC
  tenantScoped: z.boolean().default(true),    // scoped by tenant
  isActive: z.boolean().default(true),        // entity type is active
  auditTrail: z.boolean().default(true),      // track changes
})

export type EntityDefinition = z.infer<typeof EntityDefinitionSchema>

// Entity Registry — all definable entities with their field schemas
export const EntityRegistrySchema = z.array(EntityDefinitionSchema)
export type EntityRegistry = z.infer<typeof EntityRegistrySchema>

// --- Specific Entity Definitions ---
// These are the actual definitions admin can edit

// Academic Year
export const AcademicYearFields = [
  { key: 'name', label: 'Year Name', type: 'string' as const, required: true },
  { key: 'startDate', label: 'Start Date', type: 'date' as const, required: true },
  { key: 'endDate', label: 'End Date', type: 'date' as const, required: true },
  { key: 'isCurrent', label: 'Is Current', type: 'boolean' as const, default: false },
]

// Term
export const TermFields = [
  { key: 'name', label: 'Term Name', type: 'string' as const, required: true },
  { key: 'academicYearId', label: 'Academic Year', type: 'select' as const, required: true },
  { key: 'startDate', label: 'Start Date', type: 'date' as const, required: true },
  { key: 'endDate', label: 'End Date', type: 'date' as const, required: true },
  { key: 'weeks', label: 'Teaching Weeks', type: 'number' as const, default: 14 },
  { key: 'status', label: 'Status', type: 'select' as const, required: true, options: [
    { value: 'PLANNING', label: 'Planning' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'ASSESSMENT', label: 'Assessment' },
    { value: 'REPORTING', label: 'Reporting' },
    { value: 'CLOSED', label: 'Closed' },
  ]},
]

// Class Level
export const ClassLevelFields = [
  { key: 'code', label: 'Code', type: 'string' as const, required: true },
  { key: 'name', label: 'Display Name', type: 'string' as const, required: true },
  { key: 'phase', label: 'Phase', type: 'select' as const, required: true, options: [
    { value: 'KINDERGARTEN', label: 'Kindergarten' },
    { value: 'PRIMARY', label: 'Primary' },
    { value: 'JHS', label: 'Junior High' },
    { value: 'SHS', label: 'Senior High' },
  ]},
  { key: 'order', label: 'Order', type: 'number' as const, required: true },
  { key: 'ageMin', label: 'Min Age', type: 'number' as const },
  { key: 'ageMax', label: 'Max Age', type: 'number' as const },
]

// Subject
export const SubjectFields = [
  { key: 'code', label: 'Code', type: 'string' as const, required: true },
  { key: 'name', label: 'Name', type: 'string' as const, required: true },
  { key: 'category', label: 'Category', type: 'select' as const, options: [
    { value: 'LANGUAGE', label: 'Language' },
    { value: 'MATHEMATICS', label: 'Mathematics' },
    { value: 'SCIENCE', label: 'Science' },
    { value: 'SOCIAL_STUDIES', label: 'Social Studies' },
    { value: 'CREATIVE_ARTS', label: 'Creative Arts' },
    { value: 'PHYSICAL_EDUCATION', label: 'Physical Education' },
    { value: 'ICT', label: 'ICT' },
    { value: 'MONTESSORI_PRACTICAL', label: 'Montessori Practical' },
    { value: 'MONTESSORI_SENSORIAL', label: 'Montessori Sensorial' },
    { value: 'MONTESSORI_LANGUAGE', label: 'Montessori Language' },
    { value: 'MONTESSORI_MATHEMATICS', label: 'Montessori Mathematics' },
    { value: 'MONTESSORI_CULTURAL', label: 'Montessori Cultural' },
    { value: 'OTHER', label: 'Other' },
  ]},
  { key: 'isCore', label: 'Is Core', type: 'boolean' as const, default: true },
  { key: 'creditHours', label: 'Credit Hours', type: 'number' as const, default: 1 },
  { key: 'description', label: 'Description', type: 'text' as const },
  { key: 'color', label: 'Color', type: 'color' as const },
]

// Grading Scale
export const GradingScaleFields = [
  { key: 'name', label: 'Scale Name', type: 'string' as const, required: true },
  { key: 'description', label: 'Description', type: 'text' as const },
  { key: 'isDefault', label: 'Use as Default', type: 'boolean' as const },
  { key: 'appliesToLevels', label: 'Applies To Levels', type: 'multiselect' as const },
]

// Role
export const RoleFields = [
  { key: 'name', label: 'Role Name', type: 'string' as const, required: true },
  { key: 'description', label: 'Description', type: 'text' as const },
  { key: 'isSystem', label: 'System Role (protected)', type: 'boolean' as const },
  { key: 'permissions', label: 'Permissions', type: 'multiselect' as const, required: true },
  { key: 'inheritsFrom', label: 'Inherits From', type: 'multiselect' as const },
]

// Fee Category
export const FeeCategoryFields = [
  { key: 'code', label: 'Code', type: 'string' as const, required: true },
  { key: 'name', label: 'Name', type: 'string' as const, required: true },
  { key: 'isRecurring', label: 'Is Recurring', type: 'boolean' as const, default: true },
  { key: 'defaultMandatory', label: 'Mandatory by Default', type: 'boolean' as const, default: true },
  { key: 'sortOrder', label: 'Display Order', type: 'number' as const, default: 0 },
]

// Payment Method
export const PaymentMethodFields = [
  { key: 'code', label: 'Code', type: 'string' as const, required: true },
  { key: 'name', label: 'Display Name', type: 'string' as const, required: true },
  { key: 'instructions', label: 'Instructions for Parents', type: 'text' as const },
  { key: 'isEnabled', label: 'Enabled', type: 'boolean' as const, default: true },
  { key: 'sortOrder', label: 'Display Order', type: 'number' as const, default: 0 },
  { key: 'providerConfig', label: 'Provider Settings', type: 'json' as const },
]

// Branding
export const BrandingFields = [
  { key: 'name', label: 'School Name', type: 'string' as const, required: true },
  { key: 'logoUrl', label: 'Logo', type: 'url' as const },
  { key: 'primaryColor', label: 'Primary Color', type: 'color' as const, default: '#059669' },
  { key: 'secondaryColor', label: 'Secondary Color', type: 'color' as const, default: '#0891b3' },
  { key: 'accentColor', label: 'Accent Color', type: 'color' as const, default: '#d97706' },
  { key: 'motto', label: 'Motto', type: 'string' as const },
  { key: 'phone', label: 'Phone', type: 'string' as const },
  { key: 'email', label: 'Email', type: 'email' as const },
  { key: 'address', label: 'Address', type: 'text' as const },
  { key: 'socialLinks', label: 'Social Links', type: 'json' as const },
]

// News/Announcement
export const NewsFields = [
  { key: 'title', label: 'Title', type: 'string' as const, required: true },
  { key: 'bodyEn', label: 'Content (English)', type: 'text' as const, required: true, translatable: true },
  { key: 'bodyTw', label: 'Content (Twi)', type: 'text' as const, translatable: true },
  { key: 'excerptEn', label: 'Excerpt (English)', type: 'string' as const, translatable: true },
  { key: 'excerptTw', label: 'Excerpt (Twi)', type: 'string' as const, translatable: true },
  { key: 'category', label: 'Category', type: 'string' as const },
  { key: 'featuredImage', label: 'Featured Image', type: 'url' as const },
  { key: 'audience', label: 'Audience', type: 'multiselect' as const },
  { key: 'status', label: 'Status', type: 'select' as const, options: [
    { value: 'DRAFT', label: 'Draft' },
    { value: 'PUBLISHED', label: 'Published' },
    { value: 'ARCHIVED', label: 'Archived' },
  ]},
  { key: 'publishedAt', label: 'Publish Date', type: 'datetime' as const },
]

// Event
export const EventFields = [
  { key: 'title', label: 'Title', type: 'string' as const, required: true },
  { key: 'descriptionEn', label: 'Description (English)', type: 'text' as const, required: true, translatable: true },
  { key: 'descriptionTw', label: 'Description (Twi)', type: 'text' as const, translatable: true },
  { key: 'startDate', label: 'Start Date', type: 'datetime' as const, required: true },
  { key: 'endDate', label: 'End Date', type: 'datetime' as const, required: true },
  { key: 'location', label: 'Location', type: 'string' as const },
  { key: 'audience', label: 'Audience', type: 'multiselect' as const },
  { key: 'isAllDay', label: 'All Day', type: 'boolean' as const, default: false },
  { key: 'recurrence', label: 'Repeat', type: 'string' as const },
]

// Default entity registry
export const DEFAULT_ENTITY_REGISTRY = [
  {
    type: 'academic_year',
    name: 'Academic Year',
    namePlural: 'Academic Years',
    description: 'Manage school academic years and their date ranges',
    icon: 'calendar',
    color: '#059669',
    fields: AcademicYearFields.map(f => EntityFieldSchema.parse(f)),
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    allowImport: false,
    defaultSortBy: 'startDate',
    defaultSortOrder: 'desc',
    searchFields: ['name'],
    filterFields: ['isCurrent'],
    hasPermissions: true,
  },
  {
    type: 'term',
    name: 'Term',
    namePlural: 'Terms',
    description: 'Manage school terms within academic years',
    icon: 'calendar-days',
    color: '#0891b3',
    fields: TermFields.map(f => EntityFieldSchema.parse(f)),
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'class_level',
    name: 'Class Level',
    namePlural: 'Class Levels',
    description: 'Define educational levels (KG1, B1, JHS 1, etc.)',
    icon: 'graduation-cap',
    color: '#7c3aed',
    fields: ClassLevelFields.map(f => EntityFieldSchema.parse(f)),
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'subject',
    name: 'Subject',
    namePlural: 'Subjects',
    description: 'Manage all school subjects and their properties',
    icon: 'book-open',
    color: '#ea580c',
    fields: SubjectFields.map(f => EntityFieldSchema.parse(f)),
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'grading_scale',
    name: 'Grading Scale',
    namePlural: 'Grading Scales',
    description: 'Grading scales: the percentage bands a school reports against. A band is presentation, not policy — the percentage is the mark',
    icon: 'scale',
    color: '#dc2626',
    fields: GradingScaleFields.map(f => EntityFieldSchema.parse(f)),
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'role',
    name: 'Role',
    namePlural: 'Roles',
    description: 'Manage user roles and their permissions',
    icon: 'shield',
    color: '#0369a1',
    fields: RoleFields.map(f => EntityFieldSchema.parse(f)),
    allowAdd: false,
    allowEdit: true,
    allowDelete: false, // system roles protected
    hasPermissions: true,
  },
  {
    type: 'fee_category',
    name: 'Fee Category',
    namePlural: 'Fee Categories',
    description: 'Manage fee categories (tuition, uniforms, books, etc.)',
    icon: 'tag',
    color: '#16a34a',
    fields: FeeCategoryFields.map(f => EntityFieldSchema.parse(f)),
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'payment_method',
    name: 'Payment Method',
    namePlural: 'Payment Methods',
    description: 'Configure payment methods (MoMo, Bank, Cash, etc.)',
    icon: 'credit-card',
    color: '#701fa3',
    fields: PaymentMethodFields.map(f => EntityFieldSchema.parse(f)),
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'branding',
    name: 'School Branding',
    namePlural: 'School Branding',
    description: 'Manage school name, logo, colors, contact info',
    icon: 'palette',
    color: '#db2777',
    fields: BrandingFields.map(f => EntityFieldSchema.parse(f)),
    allowAdd: false, // singleton
    allowEdit: true,
    allowDelete: false,
    hasPermissions: true,
  },
  {
    type: 'news',
    name: 'News',
    namePlural: 'News & Announcements',
    description: 'Manage news articles and announcements',
    icon: 'newspaper',
    color: '#2563eb',
    fields: NewsFields.map(f => EntityFieldSchema.parse(f)),
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'event',
    name: 'Event',
    namePlural: 'Events',
    description: 'Manage school calendar events',
    icon: 'calendar-plus',
    color: '#ea580c',
    fields: EventFields.map(f => EntityFieldSchema.parse(f)),
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'department',
    name: 'Department',
    namePlural: 'Departments',
    description: 'Manage staff departments',
    icon: 'building-2',
    color: '#16a34a',
    fields: [
      { key: 'name', label: 'Name', type: 'string' as const, required: true },
      { key: 'code', label: 'Code', type: 'string' as const, required: true },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'house',
    name: 'House',
    namePlural: 'Houses',
    description: 'Manage student houses for competitions',
    icon: 'trophy',
    color: '#d97706',
    fields: [
      { key: 'name', label: 'House Name', type: 'string' as const, required: true },
      { key: 'color', label: 'House Color', type: 'color' as const, required: true },
      { key: 'motto', label: 'Motto', type: 'string' as const },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'subject_level',
    name: 'Subject Level',
    namePlural: 'Subject Levels',
    description: 'Map subjects to class levels with period allocations',
    icon: 'book-mark',
    color: '#2563eb',
    fields: [
      { key: 'subjectId', label: 'Subject', type: 'select' as const, required: true },
      { key: 'classLevelId', label: 'Class Level', type: 'select' as const, required: true },
      { key: 'isRequired', label: 'Required', type: 'boolean' as const, default: true },
      { key: 'periodsPerWeek', label: 'Periods/Week', type: 'number' as const, default: 4 },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'class',
    name: 'Class',
    namePlural: 'Classes',
    description: 'Manage class sections (e.g., Basic 1A, KG 2B)',
    icon: 'users',
    color: '#059669',
    fields: [
      { key: 'name', label: 'Class Name', type: 'string' as const, required: true },
      { key: 'levelId', label: 'Class Level', type: 'select' as const, required: true },
      { key: 'stream', label: 'Stream', type: 'string' as const },
      { key: 'capacity', label: 'Capacity', type: 'number' as const, default: 35 },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'grading_level',
    name: 'Grading Level',
    namePlural: 'Grading Levels',
    description: 'The bands within a grading scale — percentage ranges with the label and colour this school reports them under',
    icon: 'award',
    color: '#ea580c',
    fields: [
      { key: 'gradingScaleId', label: 'Grading Scale', type: 'select' as const, required: true },
      { key: 'key', label: 'Key (e.g., A)', type: 'string' as const, required: true },
      { key: 'label', label: 'Label (e.g., Excellent)', type: 'string' as const, required: true },
      { key: 'minScore', label: 'Min Score', type: 'number' as const, required: true },
      { key: 'maxScore', label: 'Max Score', type: 'number' as const, required: true },
      { key: 'color', label: 'Color', type: 'color' as const },
      { key: 'order', label: 'Order', type: 'number' as const, required: true },
      { key: 'description', label: 'Description', type: 'text' as const },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'assessment_type',
    name: 'Assessment Type',
    namePlural: 'Assessment Types',
    description: "The school's own continuous assessment scheme: which components are recorded and what each is worth",
    icon: 'clipboard-check',
    color: '#7c3aed',
    fields: [
      { key: 'code', label: 'Code', type: 'string' as const, required: true },
      { key: 'name', label: 'Name', type: 'string' as const, required: true },
      { key: 'description', label: 'Description', type: 'text' as const, helpText: 'How this school uses the component, e.g. "SBA 1 and SBA 2 are recorded separately; each carries the SBA weight."' },
      // A relative weight, not a share of the terminal mark. The report composes
      // a normalised weighted mean, so only the ratio between components matters
      // and the set is not required to sum to 1 — it usually cannot, because SBA
      // repeats three times in a term.
      { key: 'defaultWeight', label: 'Default Weight (relative)', type: 'number' as const, default: 0.1, helpText: 'Relative weight of every assessment of this type. A new assessment inherits it unless it is given a weight of its own. The report normalises the weights it finds, so these need not add up to 1.' },
      { key: 'maxScore', label: 'Max Score', type: 'number' as const, default: 100 },
      { key: 'isActive', label: 'Active', type: 'boolean' as const, default: true, helpText: 'Retire a type by turning this off. Past reports keep resolving against it; it simply stops being offered for new assessments.' },
      { key: 'appliesToLevels', label: 'Applies To Levels', type: 'multiselect' as const },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'fee_structure',
    name: 'Fee Structure',
    namePlural: 'Fee Structures',
    description: 'Define fee structures per class level per term',
    icon: 'file-text',
    color: '#0891b3',
    fields: [
      { key: 'name', label: 'Structure Name', type: 'string' as const, required: true },
      { key: 'academicYearId', label: 'Academic Year', type: 'select' as const, required: true },
      { key: 'termId', label: 'Term', type: 'select' as const, required: true },
      { key: 'classLevelId', label: 'Class Level', type: 'select' as const, required: true },
      { key: 'isActive', label: 'Active', type: 'boolean' as const, default: true },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'fee_line_item',
    name: 'Fee Line Item',
    namePlural: 'Fee Line Items',
    description: 'Individual fee items within a structure',
    icon: 'list',
    color: '#059669',
    fields: [
      { key: 'feeStructureId', label: 'Fee Structure', type: 'select' as const, required: true },
      { key: 'categoryId', label: 'Category', type: 'select' as const, required: true },
      { key: 'amount', label: 'Amount (GHS)', type: 'number' as const, required: true },
      { key: 'isMandatory', label: 'Mandatory', type: 'boolean' as const, default: true },
      { key: 'sortOrder', label: 'Sort Order', type: 'number' as const, default: 0 },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'staff',
    name: 'Staff',
    namePlural: 'Staff Members',
    description: 'Manage teaching and non-teaching staff',
    icon: 'user-check',
    color: '#0369a1',
    fields: [
      { key: 'employeeId', label: 'Employee ID', type: 'string' as const, required: true },
      { key: 'firstName', label: 'First Name', type: 'string' as const, required: true },
      { key: 'lastName', label: 'Last Name', type: 'string' as const, required: true },
      { key: 'gender', label: 'Gender', type: 'select' as const, options: [{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }] },
      { key: 'phone', label: 'Phone', type: 'string' as const },
      { key: 'email', label: 'Email', type: 'email' as const },
      { key: 'hireDate', label: 'Hire Date', type: 'date' as const },
      { key: 'status', label: 'Status', type: 'select' as const, options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'ON_LEAVE', label: 'On Leave' }, { value: 'TERMINATED', label: 'Terminated' }] },
      { key: 'roleId', label: 'Role', type: 'select' as const, required: true },
      { key: 'departmentId', label: 'Department', type: 'select' as const },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'student',
    name: 'Student',
    namePlural: 'Students',
    description: 'Manage student records',
    icon: 'graduation-cap',
    color: '#7c3aed',
    fields: [
      { key: 'admissionNumber', label: 'Admission Number', type: 'string' as const, required: true },
      { key: 'firstName', label: 'First Name', type: 'string' as const, required: true },
      { key: 'lastName', label: 'Last Name', type: 'string' as const, required: true },
      { key: 'gender', label: 'Gender', type: 'select' as const, options: [{ value: 'MALE', label: 'Male' }, { value: 'FEMALE', label: 'Female' }] },
      { key: 'dateOfBirth', label: 'Date of Birth', type: 'date' as const, required: true },
      { key: 'admissionDate', label: 'Admission Date', type: 'date' as const, required: true },
      { key: 'status', label: 'Status', type: 'select' as const, options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }, { value: 'GRADUATED', label: 'Graduated' }, { value: 'TRANSFERRED', label: 'Transferred' }] },
      { key: 'classId', label: 'Class', type: 'select' as const, required: true },
      { key: 'houseId', label: 'House', type: 'select' as const },
      { key: 'parentId', label: 'Parent', type: 'select' as const },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  {
    type: 'parent',
    name: 'Parent',
    namePlural: 'Parents/Guardians',
    description: 'Manage parent/guardian records',
    icon: 'users',
    color: '#db2777',
    fields: [
      { key: 'firstName', label: 'First Name', type: 'string' as const, required: true },
      { key: 'lastName', label: 'Last Name', type: 'string' as const, required: true },
      { key: 'phone', label: 'Phone', type: 'string' as const, required: true },
      { key: 'email', label: 'Email', type: 'email' as const },
      { key: 'address', label: 'Address', type: 'text' as const },
      { key: 'occupation', label: 'Occupation', type: 'string' as const },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    hasPermissions: true,
  },
  // Field list mirrors the `AttendanceTaker` model: id, tenantId, schoolId and
  // the timestamps are assigned by the route, and `classId` is nullable — a null
  // classId is a school-wide grant, which is why it is not `required`.
  {
    type: 'attendance_taker',
    name: 'Attendance Taker',
    namePlural: 'Attendance Takers',
    description: 'Assign staff to mark student and staff attendance, per class or school-wide',
    icon: 'clipboard-check',
    color: '#0d9488',
    fields: [
      { key: 'schoolId', label: 'School', type: 'select' as const, required: true },
      { key: 'classId', label: 'Class (blank for school-wide)', type: 'select' as const },
      { key: 'staffId', label: 'Staff Member', type: 'select' as const, required: true },
      { key: 'canMarkStudent', label: 'Can Mark Student Attendance', type: 'boolean' as const, default: true },
      { key: 'canMarkStaff', label: 'Can Mark Staff Attendance', type: 'boolean' as const, default: false },
      { key: 'isActive', label: 'Active', type: 'boolean' as const, default: true },
    ],
    allowAdd: true,
    allowEdit: true,
    allowDelete: true,
    defaultSortBy: 'createdAt',
    defaultSortOrder: 'desc',
    filterFields: ['schoolId', 'classId', 'staffId', 'isActive'],
    hasPermissions: true,
  },
// The cast is required: entries written with inline `fields` arrays are missing
// the defaulted keys `EntityFieldSchema` fills in (`required`, `order`,
// `isSystem`, `translatable`), so they are not assignable to `EntityDefinition[]`
// as written. It must stay honest, so `EntityRegistrySchema.parse` on this array
// is asserted by a test rather than assumed.
] as EntityDefinition[]

export const CONFIG_VERSION = '1.0.0'
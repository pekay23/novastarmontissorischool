'use client'

import { useCallback, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Button, Card, CardContent, CardHeader, CardTitle, useToast } from '@novastar/shared-ui'
import { formatPhone } from '@novastar/shared-utils'
import { SCHOOL_INFO } from '@/lib/metadata'

/*
 * Client-only because the whole thing is one multi-step form: step state and
 * per-step validation all live in React state.
 *
 * It is split out of `app/admissions/page.tsx` because that page owns the page
 * `metadata`, which Next only resolves on the server.
 */

type Step = 'personal' | 'parent' | 'academic' | 'review'

const PROGRAMMES = [
  { value: 'creche', label: 'Crèche & Nursery' },
  { value: 'kg', label: 'Kindergarten (KG1 / KG2)' },
  { value: 'lower-primary', label: 'Lower Primary (B1–B3)' },
  { value: 'upper-primary', label: 'Upper Primary (B4–B6)' },
  { value: 'jhs', label: 'Junior High (JHS 1–3)' },
]

const PROGRAMME_LABELS = Object.fromEntries(PROGRAMMES.map((p) => [p.value, p.label]))

const EMPTY: AdmissionsFormData = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: 'MALE',
  parentName: '',
  parentPhone: '',
  parentEmail: '',
  address: '',
  program: '',
  currentSchool: '',
  previousResults: '',
}

interface AdmissionsFormData {
  firstName: string
  lastName: string
  dateOfBirth: string
  gender: string
  parentName: string
  parentPhone: string
  parentEmail: string
  address: string
  program: string
  currentSchool: string
  previousResults: string
}

const STEPS: { id: Step; label: string }[] = [
  { id: 'personal', label: 'Student Info' },
  { id: 'parent', label: 'Parent/Guardian' },
  { id: 'academic', label: 'Academic Info' },
  { id: 'review', label: 'Review & Submit' },
]

export function AdmissionsForm() {
  const { toast } = useToast()
  const [currentStep, setCurrentStep] = useState<Step>('personal')
  const [formData, setFormData] = useState<AdmissionsFormData>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof AdmissionsFormData, string>>>({})

  /*
    Focus follows step changes. Advancing unmounts the whole field set, so
    without this the focus ring drops to <body> and a keyboard or screen-reader
    user is left with no indication that anything happened (WCAG 2.4.3).
  */
  const panelRef = useRef<HTMLDivElement>(null)

  const focusStep = (step: Step) => {
    setCurrentStep(step)
    requestAnimationFrame(() => panelRef.current?.focus())
  }

  /*
    Per-step validation. Next cannot advance past an incomplete step, which
    means the review step is always a truthful summary and the server is never
    handed a half-filled application. The API re-validates regardless.
  */
  const validateStep = (step: Step): boolean => {
    const found: Partial<Record<keyof AdmissionsFormData, string>> = {}
    const need = (field: keyof AdmissionsFormData, message: string) => {
      if (!formData[field]?.trim()) found[field] = message
    }

    if (step === 'personal') {
      need('firstName', 'Enter the child’s first name')
      need('lastName', 'Enter the child’s last name')
      need('dateOfBirth', 'Enter the child’s date of birth')
    }
    if (step === 'parent') {
      need('parentName', 'Enter the parent or guardian’s name')
      need('parentPhone', 'Enter a phone number we can reach you on')
      need('address', 'Enter your home address')
      if (formData.parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.parentEmail)) {
        found.parentEmail = 'That email address does not look right'
      }
    }
    if (step === 'academic') {
      need('program', 'Choose the programme you are applying to')
    }

    setErrors(found)
    if (Object.keys(found).length > 0) {
      toast.error({
        title: 'Check the highlighted fields',
        description: 'A few details are still needed before you can continue.',
      })
      return false
    }
    return true
  }

  const updateField = (field: keyof AdmissionsFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    // Clear the field's error as soon as the visitor starts fixing it.
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev))
  }

  const stepIndex = STEPS.findIndex((s) => s.id === currentStep)

  /*
    There is nowhere to POST to.

    The site is built with `output: 'export'`, so `app/api/admissions` is not
    part of the deployed bundle — `out/` contains no `api` directory. The old
    submit path fetched that URL, so in production every application 404'd and
    the parent was shown a failure after filling in four screens of detail.
    The handler was a stub in any case: it console.logged the body and returned
    success without storing or forwarding anything.

    So the review step hands the completed application to a channel that
    genuinely works on a static host — WhatsApp, which is how Ghanaian parents
    expect to reach a school, with email as the fallback.
  */
  const applicationMessage = useCallback(() => {
    const lines = [
      `New application — ${SCHOOL_INFO.name}`,
      '',
      `Child: ${formData.firstName} ${formData.lastName}`,
      `Date of birth: ${formData.dateOfBirth}`,
      `Gender: ${formData.gender}`,
      '',
      `Parent/Guardian: ${formData.parentName}`,
      `Phone: ${formData.parentPhone}`,
      formData.parentEmail ? `Email: ${formData.parentEmail}` : null,
      `Address: ${formData.address}`,
      '',
      `Programme: ${PROGRAMME_LABELS[formData.program] ?? formData.program}`,
      formData.currentSchool ? `Current school: ${formData.currentSchool}` : null,
      formData.previousResults ? `Previous results: ${formData.previousResults}` : null,
    ].filter((line): line is string => line !== null)
    return lines.join('\n')
  }, [formData])

  const whatsappHref = `https://wa.me/${SCHOOL_INFO.whatsapp}?text=${encodeURIComponent(applicationMessage())}`
  const mailtoHref = `mailto:${SCHOOL_INFO.email}?subject=${encodeURIComponent(
    `Admissions application — ${formData.firstName} ${formData.lastName}`
  )}&body=${encodeURIComponent(applicationMessage())}`

  return (
    <Card>
      <CardHeader>
        <CardTitle id="admissions-form-title">Online Application Form</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="mb-6 flex items-center justify-between">
          {STEPS.map((step, i) => (
            <li
              key={step.id}
              aria-current={currentStep === step.id ? 'step' : undefined}
              className={`flex-1 text-center ${
                currentStep === step.id
                  ? 'font-semibold text-primary'
                  : 'text-muted-foreground'
              }`}
            >
              <span
                className={`mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                  currentStep === step.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {i + 1}
              </span>
              {step.label}
            </li>
          ))}
        </ol>

        <div
          ref={panelRef}
          tabIndex={-1}
          className="outline-none"
          /* Announced when a step swaps the entire field set, which would
             otherwise be a silent change for a screen-reader user. */
          aria-live="polite"
        >
          Step {Math.min(stepIndex + 1, STEPS.length)} of {STEPS.length}:{' '}
          {STEPS[stepIndex]?.label}
        </div>

        <form aria-labelledby="admissions-form-title" className="space-y-6">
          {currentStep === 'personal' && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="First Name"
                  value={formData.firstName}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('firstName', e.target.value)}
                  error={errors.firstName}
                  required
                />
                <Input
                  label="Last Name"
                  value={formData.lastName}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('lastName', e.target.value)}
                  error={errors.lastName}
                  required
                />
              </div>
              <Input
                label="Date of Birth"
                type="date"
                value={formData.dateOfBirth}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('dateOfBirth', e.target.value)}
                error={errors.dateOfBirth}
                required
              />
              <RadioGroup
                label="Gender"
                options={[
                  { value: 'MALE', label: 'Male' },
                  { value: 'FEMALE', label: 'Female' },
                  { value: 'OTHER', label: 'Other' },
                ]}
                value={formData.gender}
                onChange={(val: string) => updateField('gender', val)}
              />
            </>
          )}

          {currentStep === 'parent' && (
            <>
              <Input
                label="Parent/Guardian Full Name"
                value={formData.parentName}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('parentName', e.target.value)}
                error={errors.parentName}
                required
              />
              <Input
                label="Phone Number"
                value={formData.parentPhone}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('parentPhone', e.target.value)}
                placeholder="+233 55 000 0000"
                error={errors.parentPhone}
                required
              />
              <Input
                label="Email Address"
                type="email"
                value={formData.parentEmail}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('parentEmail', e.target.value)}
                error={errors.parentEmail}
              />
              <Input
                label="Home Address"
                value={formData.address}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('address', e.target.value)}
                error={errors.address}
                required
              />
            </>
          )}

          {currentStep === 'academic' && (
            <>
              <Select
                label="Program Applying For"
                value={formData.program}
                onValueChange={(val: string) => updateField('program', val)}
                options={PROGRAMMES}
                error={errors.program}
                required
              />
              <Input
                label="Current School (if applicable)"
                value={formData.currentSchool}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('currentSchool', e.target.value)}
              />
              <Textarea
                label="Previous Academic Results"
                value={formData.previousResults}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => updateField('previousResults', e.target.value)}
                placeholder="Share any relevant academic information..."
              />
            </>
          )}

          {currentStep === 'review' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-primary">Review Your Application</h3>
              <ReviewItem label="Student" value={`${formData.firstName} ${formData.lastName}`.trim()} />
              <ReviewItem label="Date of birth" value={formData.dateOfBirth} />
              <ReviewItem label="Parent/Guardian" value={formData.parentName} />
              <ReviewItem label="Phone" value={formatPhone(formData.parentPhone)} />
              <ReviewItem label="Email" value={formData.parentEmail} />
              <ReviewItem label="Address" value={formData.address} />
              <ReviewItem
                label="Programme"
                value={PROGRAMME_LABELS[formData.program] ?? formData.program}
              />
              <p className="text-xs text-muted-foreground">
                By sending this, you confirm the information is accurate and consent to
                the school&apos;s admissions process.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t pt-5">
              <Button
                type="button"
                variant="ghost"
                onClick={() => focusStep(STEPS[stepIndex - 1].id)}
                disabled={stepIndex <= 0}
              >
                Back
              </Button>

              {currentStep !== 'review' ? (
                <Button
                  type="button"
                  onClick={() => {
                    if (validateStep(currentStep) && stepIndex < STEPS.length - 1) {
                      focusStep(STEPS[stepIndex + 1].id)
                    }
                  }}
                >
                  Next
                </Button>
              ) : (
                <div className="flex flex-col items-end gap-2">
                  <Button type="button" asChild>
                    <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                      Send via WhatsApp
                    </a>
                  </Button>
                  <Button type="button" variant="ghost" asChild>
                    <a href={mailtoHref}>Email it instead</a>
                  </Button>
                </div>
              )}
            </div>
        </form>

        {/* Explains where the application goes. Without this the review step's
            two external links read like navigation rather than submission, and a
            parent may assume nothing was sent. */}
        <p className="mt-6 rounded-lg bg-surface p-4 text-sm text-muted-foreground">
          Nothing is stored on this website. Choose a channel above and press send
          there — WhatsApp or your email app will open with your application filled
          in. Our admissions office replies on the number you gave us, usually within
          two working days.
        </p>
      </CardContent>
    </Card>
  )
}

function Input({
  label,
  value,
  onChange,
  type,
  placeholder,
  required,
  error,
}: {
  label?: string
  value?: string
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
  type?: string
  placeholder?: string
  required?: boolean
  error?: string
}) {
  const id = fieldId(label)
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-error-text" aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
        name={fieldName(label)}
        type={type || 'text'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`w-full rounded-md border bg-surface px-3 py-2.5 text-foreground transition-colors placeholder:text-muted-foreground ${
          error ? 'border-destructive' : 'border-input'
        }`}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-error-text">
          {error}
        </p>
      )}
    </div>
  )
}

function Textarea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label?: string
  value?: string
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
}) {
  const id = fieldId(label)
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <textarea
        id={id}
        name={fieldName(label)}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={4}
        className="w-full rounded-md border border-input bg-surface px-3 py-2.5 text-foreground placeholder:text-muted-foreground"
      />
    </div>
  )
}

function RadioGroup({
  label,
  options,
  value,
  onChange,
}: {
  label?: string
  options: Array<{ value: string; label: string }>
  value?: string
  onChange?: (value: string) => void
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">{label}</legend>
      <div className="flex flex-wrap gap-5">
        {options.map((opt) => (
          <label key={opt.value} className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name={label}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange?.(opt.value)}
              className="h-4 w-4 accent-primary"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Select({
  label,
  value,
  onValueChange,
  options,
  required,
  error,
}: {
  label?: string
  value?: string
  onValueChange?: (value: string) => void
  options: Array<{ value: string; label: string }>
  required?: boolean
  error?: string
}) {
  const id = fieldId(label)
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-error-text" aria-hidden="true"> *</span>}
      </label>
      <select
        id={id}
        name={fieldName(label)}
        value={value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value)}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`w-full rounded-md border bg-surface px-3 py-2.5 text-foreground ${
          error ? 'border-destructive' : 'border-input'
        }`}
      >
        <option value="">Choose a programme…</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={`${id}-error`} className="text-sm text-error-text">
          {error}
        </p>
      )}
    </div>
  )
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || '—'}</span>
    </div>
  )
}

/** Stable ids so each `<label htmlFor>` points at a real control. */
function fieldId(label?: string): string {
  return `f-${slug(label)}`
}

/**
 * `name` for the same controls. Without one no field participates in browser
 * autofill or form restoration, so a parent retyping their address after an
 * error is a needless cost.
 */
function fieldName(label?: string): string {
  return slug(label).replace(/-/g, '_')
}

function slug(label?: string): string {
  return (label ?? 'field')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
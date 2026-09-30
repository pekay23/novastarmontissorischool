'use client'

import { useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import { Button } from '@novastar/shared-ui'
import { Card, CardContent, CardHeader, CardTitle } from '@novastar/shared-ui'
import { useToast } from '@novastar/shared-ui'

import { formatPhone } from '@novastar/shared-utils'

type Step = 'personal' | 'parent' | 'academic' | 'review' | 'success'

const PROGRAMMES = [
  { value: 'creche', label: 'Crèche & Nursery' },
  { value: 'kg', label: 'Kindergarten (KG1 / KG2)' },
  { value: 'lower-primary', label: 'Lower Primary (B1–B3)' },
  { value: 'upper-primary', label: 'Upper Primary (B4–B6)' },
  { value: 'jhs', label: 'Junior High (JHS 1–3)' },
]

const PROGRAMME_LABELS = Object.fromEntries(PROGRAMMES.map((p) => [p.value, p.label]))

const SCHOOL_WHATSAPP = '233244935251'

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

export default function AdmissionsPage() {
  const { toast } = useToast()
  const [currentStep, setCurrentStep] = useState<Step>('personal')
  const [formData, setFormData] = useState<AdmissionsFormData>({
    // Personal
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    gender: 'MALE',
    // Parent
    parentName: '',
    parentPhone: '',
    parentEmail: '',
    address: '',
    // Academic
    program: '',
    currentSchool: '',
    previousResults: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof AdmissionsFormData, string>>>({})

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

  const steps: { id: Step; label: string }[] = [
    { id: 'personal', label: 'Student Info' },
    { id: 'parent', label: 'Parent/Guardian' },
    { id: 'academic', label: 'Academic Info' },
    { id: 'review', label: 'Review & Submit' },
  ]

  const updateField = (field: keyof AdmissionsFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    // Clear the field's error as soon as the visitor starts fixing it.
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev))
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (currentStep !== 'review') return

    setSubmitting(true)
    try {
      const res = await fetch('/api/admissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (res.ok) {
        toast.success({
          title: 'Application Submitted',
          description: 'Thank you for applying! We will review your application and contact you soon.',
        })
        setCurrentStep('success')
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to submit application' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to submit application' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="bg-gradient-to-b from-primary/10 to-transparent py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-responsive-h1 font-heading text-primary mb-4">Admissions</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            We'd love to welcome your child to our learning community. Apply online or contact us for more information.
          </p>
        </div>
      </section>

      {/* Process Overview */}
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-responsive-h2 font-heading text-primary mb-4">Admission Process</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Simple 4-step process to get your child enrolled at Novastar Montessori School.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <ProcessStep number="1" title="Apply Online" desc="Fill our online application form" />
            <ProcessStep number="2" title="Documents" desc="Submit required documents" />
            <ProcessStep number="3" title="Assessment" desc="Student assessment & interview" />
            <ProcessStep number="4" title="Enroll" desc="Receive acceptance & register" />
          </div>
        </div>
      </section>

      {/* Application Form */}
      <section className="py-12 md:py-16 bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle>Online Application Form</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Steps */}
                <div className="flex items-center justify-between mb-6">
                  {steps.map((step) => (
                    <div
                      key={step.id}
                      className={`flex-1 text-center ${
                        currentStep === step.id
                          ? 'text-primary font-semibold'
                          : 'text-muted-foreground'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full mx-auto mb-1 flex items-center justify-center text-xs font-bold ${
                        currentStep === step.id
                          ? 'bg-primary text-white'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {steps.findIndex((s) => s.id === step.id) + 1}
                      </div>
                      {step.label}
                    </div>
                  ))}
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-6">
                  {currentStep === 'personal' && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                      <ReviewItem label="Student" value={`${formData.firstName} ${formData.lastName}`} />
                      <ReviewItem label="Date of birth" value={formData.dateOfBirth} />
                      <ReviewItem label="Parent/Guardian" value={formData.parentName} />
                      <ReviewItem label="Phone" value={formatPhone(formData.parentPhone)} />
                      <ReviewItem label="Email" value={formData.parentEmail} />
                      <ReviewItem label="Address" value={formData.address} />
                      <ReviewItem
                        label="Programme"
                        value={PROGRAMME_LABELS[formData.program] ?? formData.program}
                      />
                      <div className="text-xs text-muted-foreground">
                        <p>By submitting, you confirm the information is accurate and consent to the school's admissions process.</p>
                      </div>
                    </div>
                  )}

                  {/* Navigation */}
                  {currentStep !== 'success' && (
                    <div className="flex items-center justify-between gap-3 border-t pt-5">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          const idx = steps.findIndex((s) => s.id === currentStep)
                          if (idx > 0) setCurrentStep(steps[idx - 1].id)
                        }}
                        disabled={currentStep === 'personal' || submitting}
                      >
                        Back
                      </Button>

                      {/*
                        The forward action was missing entirely. There was a
                        Back button and a Submit button that only rendered on
                        the review step, so a visitor could never get from step
                        one to step two and no application could ever be
                        submitted. Next is also the natural place to block
                        advancing on incomplete required fields.
                      */}
                      {currentStep !== 'review' ? (
                        <Button
                          type="button"
                          onClick={() => {
                            if (validateStep(currentStep)) {
                              const idx = steps.findIndex((s) => s.id === currentStep)
                              if (idx < steps.length - 1) setCurrentStep(steps[idx + 1].id)
                            }
                          }}
                        >
                          Next
                        </Button>
                      ) : (
                        <Button type="submit" disabled={submitting}>
                          {submitting ? 'Submitting…' : 'Submit application'}
                        </Button>
                      )}
                    </div>
                  )}
                </form>

                {currentStep === 'success' && (
                  <div className="py-8 text-center" role="status">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft">
                      <svg className="h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h3 className="mb-2 text-xl text-primary-dark">Application received</h3>
                    <p className="mx-auto max-w-md text-muted-foreground">
                      Thank you. Our admissions office reviews applications in the order they
                      arrive and will call you on the number you gave us, usually within two
                      working days.
                    </p>
                    <p className="mx-auto mt-4 max-w-md text-sm text-muted-foreground">
                      Need to add another child, or would rather talk to us first?{' '}
                      <a
                        href={`https://wa.me/${SCHOOL_WHATSAPP}?text=${encodeURIComponent(
                          'Hello, I have just submitted an application and would like to add some information.',
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-primary-dark underline"
                      >
                        Message us on WhatsApp
                      </a>
                      .
                    </p>
                    <Button
                      variant="outline"
                      className="mt-6"
                      onClick={() => {
                        setFormData({
                          firstName: '', lastName: '', dateOfBirth: '', gender: 'MALE',
                          parentName: '', parentPhone: '', parentEmail: '', address: '',
                          program: '', currentSchool: '', previousResults: '',
                        })
                        setErrors({})
                        setCurrentStep('personal')
                      }}
                    >
                      Submit another application
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </div>
  )
}

function ProcessStep({ number, title, desc }: { number: string; title: string; desc: string }) {
  return (
    <div className="text-center p-4 bg-white dark:bg-card rounded-lg shadow-sm border border-border">
      <div className="w-10 h-10 bg-primary text-primary-foreground rounded-full flex items-center justify-center mx-auto mb-3 font-bold">
        {number}
      </div>
      <h3 className="font-semibold text-primary mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
  )
}

function Input({ label, value, onChange, type, placeholder, required, error }: {
  label?: string
  value?: string
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
  type?: string
  placeholder?: string
  required?: boolean
  error?: string
}) {
  const id = `f-${label?.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}{required && <span className="text-destructive" aria-hidden="true"> *</span>}
      </label>
      <input
        id={id}
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
      {error && <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

function Textarea({ label, value, onChange, placeholder }: {
  label?: string
  value?: string
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
}) {
  const id = `f-${label?.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
      <textarea
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={4}
        className="w-full rounded-md border border-input bg-surface px-3 py-2.5 text-foreground placeholder:text-muted-foreground"
      />
    </div>
  )
}

function RadioGroup({ label, options, value, onChange }: {
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

function Select({ label, value, onValueChange, options, required, error }: {
  label?: string
  value?: string
  onValueChange?: (value: string) => void
  options: Array<{ value: string; label: string }>
  required?: boolean
  error?: string
}) {
  const id = `f-${label?.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}{required && <span className="text-destructive" aria-hidden="true"> *</span>}
      </label>
      <select
        id={id}
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
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {error && <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value || '—'}</span>
    </div>
  )
}
'use client'

import { useState } from 'react'
import type { FormEvent, ChangeEvent } from 'react'
import { Button } from '@novastar/shared-ui'
import { Card, CardContent, CardHeader, CardTitle } from '@novastar/shared-ui'
import { useToast } from '@novastar/shared-ui'

import { formatPhone } from '@novastar/shared-utils'

type Step = 'personal' | 'parent' | 'academic' | 'review' | 'success'

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

  const steps: { id: Step; label: string }[] = [
    { id: 'personal', label: 'Student Info' },
    { id: 'parent', label: 'Parent/Guardian' },
    { id: 'academic', label: 'Academic Info' },
    { id: 'review', label: 'Review & Submit' },
  ]

  const updateField = (field: keyof AdmissionsFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
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
                          required
                        />
                        <Input
                          label="Last Name"
                          value={formData.lastName}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('lastName', e.target.value)}
                          required
                        />
                      </div>
                      <Input
                        label="Date of Birth"
                        type="date"
                        value={formData.dateOfBirth}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('dateOfBirth', e.target.value)}
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
                        required
                      />
                      <Input
                        label="Phone Number"
                        value={formData.parentPhone}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('parentPhone', e.target.value)}
                        placeholder="+233 55 441 6937"
                        required
                      />
                      <Input
                        label="Email Address"
                        type="email"
                        value={formData.parentEmail}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('parentEmail', e.target.value)}
                      />
                      <Input
                        label="Home Address"
                        value={formData.address}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => updateField('address', e.target.value)}
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
                        options={[
                          { value: 'creche', label: 'Creche & Nursery' },
                          { value: 'kg', label: 'Kindergarten (KG1/KG2)' },
                          { value: 'lower-primary', label: 'Lower Primary (B1-B3)' },
                          { value: 'upper-primary', label: 'Upper Primary (B4-B6)' },
                          { value: 'jhs', label: 'Junior High (JHS 1-3)' },
                        ]}
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
                      <ReviewItem label="DOB" value={formData.dateOfBirth} />
                      <ReviewItem label="Parent" value={formData.parentName} />
                      <ReviewItem label="Phone" value={formatPhone(formData.parentPhone)} />
                      <ReviewItem label="Program" value={formData.program} />
                      <div className="text-xs text-muted-foreground">
                        <p>By submitting, you confirm the information is accurate and consent to the school's admissions process.</p>
                      </div>
                    </div>
                  )}

                  {/* Navigation */}
                  <div className="flex justify-between pt-4 border-t">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const idx = steps.findIndex((s) => s.id === currentStep)
                        if (idx > 0) setCurrentStep(steps[idx - 1].id)
                      }}
                      disabled={currentStep === 'personal'}
                    >
                      Back
                    </Button>
                    {currentStep === 'review' && (
                      <Button type="submit" disabled={submitting}>
                        {submitting ? 'Submitting...' : 'Submit Application'}
                      </Button>
                    )}
                    {currentStep === 'success' && (
                      <Button variant="outline" onClick={() => setCurrentStep('personal')}>
                        Submit Another Application
                      </Button>
                    )}
                  </div>
                </form>

                {currentStep === 'success' && (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-semibold text-green-800 mb-2">Application Submitted Successfully!</h3>
                    <p className="text-muted-foreground">We've received your application and will review it shortly. You'll hear from us soon.</p>
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

function Input({ label, value, onChange, type, placeholder, required }: {
  label?: string
  value?: string
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
  type?: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}{required && '*'}</label>
      <input
        type={type || 'text'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  )
}

function Textarea({ label, value, onChange, placeholder }: {
  label?: string
  value?: string
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={4}
        className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
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
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex gap-4">
        {options.map((opt: { value: string; label: string }) => (
          <label key={opt.value} className="flex items-center gap-2">
            <input
              type="radio"
              name={label}
              value={opt.value}
              checked={value === opt.value}
              onChange={() => onChange?.(opt.value)}
              className="accent-primary"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  )
}

function Select({ label, value, onValueChange, options, required }: {
  label?: string
  value?: string
  onValueChange?: (value: string) => void
  options: Array<{ value: string; label: string }>
  required?: boolean
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}{required && '*'}</label>
      <select
        value={value}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onValueChange?.(e.target.value)}
        required={required}
        className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="">Select...</option>
        {options.map((opt: { value: string; label: string }) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
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
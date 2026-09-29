'use client'

import { useState, useMemo } from 'react'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  Input,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
  Button,
  Card,
  CardContent,
} from '@novastar/shared-ui'

interface FieldComponentProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- react-hook-form Controller field
  field: any
  disabled?: boolean
  options?: Array<{ value: string; label: string }>
  placeholder?: string
}
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { EntityType, DEFAULT_ENTITY_REGISTRY, EntityField } from '@novastar/shared-types'


interface EntityFormProps {
  entityType: EntityType
  initialData: Record<string, unknown> | null
  onSubmit: (data: Record<string, unknown>) => Promise<void>
  onClose: () => void
  readOnly?: boolean
}

function createSchema(fields: EntityField[]) {
  const shape: Record<string, z.ZodType> = {}

  for (const field of fields) {
    let schema: z.ZodType

    switch (field.type) {
      case 'string':
      case 'url':
      case 'email':
      case 'color':
        schema = z.string()
        break
      case 'text':
        schema = z.string()
        break
      case 'number':
        schema = z.number().or(z.string().transform(v => (v === '' ? undefined : Number(v))))
        break
      case 'boolean':
        schema = z.boolean()
        break
      case 'date':
      case 'datetime':
        schema = z.string().or(z.date())
        break
      case 'select':
      case 'multiselect':
        schema = z.union([z.string(), z.array(z.string())])
        break
      case 'json':
        schema = z.union([z.string(), z.record(z.string(), z.unknown())])
        break
      default:
        schema = z.unknown()
    }

    if (field.required && field.type !== 'boolean') {
      schema = schema.refine(v => v !== undefined && v !== '' && v !== null, {
        message: `${field.label} is required`,
      })
    } else if (field.type !== 'boolean') {
      schema = schema.optional()
    }

    if (field.validation) {
      const { min, max, pattern } = field.validation
      if (min !== undefined) {
        schema = schema.refine(v => v === undefined || Number(v) >= min, {
          message: `Must be at least ${min}`,
        })
      }
      if (max !== undefined) {
        schema = schema.refine(v => v === undefined || Number(v) <= max, {
          message: `Must be at most ${max}`,
        })
      }
      if (pattern) {
        schema = schema.refine(v => !v || new RegExp(pattern).test(String(v)), {
          message: 'Invalid format',
        })
      }
    }

    shape[field.key] = schema
  }

  return z.object(shape)
}

export function EntityForm({
  entityType,
  initialData,
  onSubmit,
  onClose,
  readOnly = false,
}: EntityFormProps) {
  const registry = DEFAULT_ENTITY_REGISTRY.find(e => e.type === entityType)
  const schema = useMemo(
    () => (registry ? createSchema(registry.fields) : null),
    [registry]
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm({
    resolver: schema ? zodResolver(schema) : undefined,
    defaultValues: initialData || {},
    mode: 'onBlur',
  })

  const handleSubmit = async (data: Record<string, unknown>) => {
    if (!schema) return

    setIsSubmitting(true)
    try {
      await onSubmit(data)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!schema || !registry) {
    return null
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            {registry.fields
              .filter(f => !f.isSystem || !readOnly)
              .map(field => {
                const Component = getFieldComponent(field)
                return (
                  <FormField
                    key={field.key}
                    control={form.control}
                    name={field.key}
                    render={({ field: formField }) => (
                      <FormItem>
                        <FormLabel>
                          {field.label}
                          {field.required && <span className="text-red-500 ml-1">*</span>}
                        </FormLabel>
                        <FormControl>
                          <Component
                            field={formField}
                            disabled={readOnly}
                            options={field.options}
                            placeholder={field.placeholder}
                          />
                        </FormControl>
                        {field.helpText && <FormDescription>{field.helpText}</FormDescription>}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )
              })}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          {!readOnly && (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : initialData ? 'Update' : 'Create'}
            </Button>
          )}
        </div>
      </form>
    </Form>
  )
}

function getFieldComponent(field: EntityField) {
  switch (field.type) {
    case 'text':
      const TextField = ({ field: formField, disabled }: FieldComponentProps) => (
        <Textarea
          {...formField}
          disabled={disabled}
          placeholder={field.placeholder}
          className="min-h-[100px]"
        />
      )
      return TextField
    case 'number':
      const NumberField = ({ field: formField, disabled }: FieldComponentProps) => (
        <Input
          type="number"
          {...formField}
          disabled={disabled}
          placeholder={field.placeholder}
          step={field.validation?.min === 0 ? '1' : 'any'}
        />
      )
      return NumberField
    case 'boolean':
      const BooleanField = ({ field: formField, disabled }: FieldComponentProps) => (
        <div className="flex items-center space-x-2">
          <Checkbox
            checked={formField.value ?? false}
            onCheckedChange={disabled ? undefined : formField.onChange}
            disabled={disabled}
          />
          <span>Enable</span>
        </div>
      )
      return BooleanField
    case 'date':
      const DateField = ({ field: formField, disabled }: FieldComponentProps) => (
        <Input
          type="date"
          {...formField}
          disabled={disabled}
          placeholder={field.placeholder}
        />
      )
      return DateField
    case 'datetime':
      const DateTimeField = ({ field: formField, disabled }: FieldComponentProps) => (
        <Input
          type="datetime-local"
          {...formField}
          disabled={disabled}
          placeholder={field.placeholder}
        />
      )
      return DateTimeField
    case 'select':
      const SelectField = ({ field: formField, disabled, options }: FieldComponentProps) => (
        <Select
          value={formField.value}
          onValueChange={disabled ? undefined : formField.onChange}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder={field.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options?.map((opt: { value: string; label: string }) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
      return SelectField
    case 'multiselect':
      const MultiSelectField = ({ field: formField, disabled, options }: FieldComponentProps) => (
        <Select
          value={Array.isArray(formField.value) ? formField.value.join(',') : ''}
          onValueChange={disabled
            ? undefined
            : (value: string) => formField.onChange(value.split(',').filter(Boolean))}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder={field.placeholder || 'Select...'} />
          </SelectTrigger>
          <SelectContent>
            {options?.map((opt: { value: string; label: string }) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
      return MultiSelectField
    case 'color':
      const ColorField = ({ field: formField, disabled }: FieldComponentProps) => (
        <Input
          type="color"
          {...formField}
          disabled={disabled}
          className="h-10 w-20"
        />
      )
      return ColorField
    case 'url':
    case 'email':
    case 'string':
    default:
      const DefaultField = ({ field: formField, disabled }: FieldComponentProps) => (
        <Input
          {...formField}
          disabled={disabled}
          placeholder={field.placeholder}
          type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}
        />
      )
      return DefaultField
  }
}
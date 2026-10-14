'use client'

import * as React from 'react'
import {
  useFormContext,
  Controller,
  FormProvider,
  type FieldValues,
  type FieldPath,
  type ControllerProps,
  type ControllerRenderProps,
  type ControllerFieldState,
  type UseFormReturn,
  type FormState,
} from 'react-hook-form'
import { Label } from './label'
import { cn } from '../lib/utils'

const Form = React.forwardRef<
  HTMLFormElement,
  React.ComponentPropsWithoutRef<'form'> & { form: UseFormReturn<FieldValues> }
>(({ className, form: rhfForm, children, onSubmit, ...props }, ref) => {
  return (
    <FormProvider {...rhfForm}>
      <form ref={ref} className={cn('space-y-4', className)} onSubmit={onSubmit} {...props}>
        {children}
      </form>
    </FormProvider>
  )
})
Form.displayName = 'Form'

type FormFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldPath<TFieldValues>
> = Omit<ControllerProps<TFieldValues, TName>, 'render'> & {
  render: ({
    field,
    fieldState,
    formState,
  }: {
    field: ControllerRenderProps<TFieldValues, TName>
    fieldState: ControllerFieldState
    formState: FormState<TFieldValues>
  }) => React.ReactNode
}

const FormField = ({ control, ...props }: FormFieldProps<FieldValues, FieldPath<FieldValues>>) => {
  const { control: contextControl } = useFormContext()
  const effectiveControl = control ?? contextControl
  if (!effectiveControl) {
    throw new Error('FormField must be used within a FormProvider or given an explicit control prop')
  }
  return (
    <Controller
      control={effectiveControl}
      {...props}
      render={({ field, fieldState, formState }) =>
        <>{props.render({ field, fieldState, formState })}</>
      }
    />
  )
}
FormField.displayName = 'FormField'

const FormItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('space-y-2', className)} {...props} />
))
FormItem.displayName = 'FormItem'

const FormLabel = React.forwardRef<
  React.ElementRef<typeof Label>,
  React.ComponentPropsWithoutRef<typeof Label>
>(({ className, ...props }, ref) => (
  <Label ref={ref} className={className} {...props} />
))
FormLabel.displayName = 'FormLabel'

const FormControl = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('mt-2', className)} {...props} />
))
FormControl.displayName = 'FormControl'

const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
FormDescription.displayName = 'FormDescription'

const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
  return (
    <p
      ref={ref}
      className={cn('text-sm font-medium text-destructive', className)}
      {...props}
    >
      {children}
    </p>
  )
})
FormMessage.displayName = 'FormMessage'

export {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
}

'use client'

import * as React from 'react'
import {
  useFormContext,
  Controller,
  type FieldValues,
  type FieldPath,
  type ControllerProps,
} from 'react-hook-form'
import { Label } from './label'
import { cn } from '../lib/utils'

const Form = React.forwardRef<
  HTMLFormElement,
  React.ComponentPropsWithoutRef<'form'>
>(({ className, ...props }, ref) => (
  <form ref={ref} className={cn('space-y-4', className)} {...props} />
))
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
    field: Record<string, unknown>
    fieldState: Record<string, unknown>
    formState: Record<string, unknown>
  }) => React.ReactNode
}

const FormField = React.forwardRef<
  HTMLFormElement,
  FormFieldProps<FieldValues, FieldPath<FieldValues>>
>(({ ...props }, _ref) => {
  const { control } = useFormContext()
  return (
    <Controller
      control={control}
      {...props}
      render={({ field, fieldState, formState }) =>
        <>{props.render({ field, fieldState, formState })}</>
      }
    />
  )
})
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

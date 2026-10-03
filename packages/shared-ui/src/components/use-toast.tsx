'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'

/*
 * No enter/exit animation classes here on purpose.
 *
 * This string used to carry `data-[state=open]:animate-in`,
 * `data-[state=closed]:animate-out` and the matching `fade-*` utilities. They
 * named two different things that do not exist: those utilities ship with the
 * `tailwindcss-animate` plugin, which is not a dependency of this repo, and
 * `ToastItem` below renders no `data-state` attribute, so the variants could
 * never match even with the plugin installed. Both facts were confirmed before
 * the classes were removed: the class names reached the DOM and Tailwind
 * silently emitted no rule for them.
 */
export const toastVariants = cva(
  'group pointer-events-auto flex w-full max-w-sm cursor-pointer gap-3 overflow-hidden rounded-md border p-4 shadow-lg transition-all',
  {
    variants: {
      variant: {
        default: 'border bg-background text-foreground',
        destructive: 'border bg-destructive text-destructive-foreground',
        success: 'border bg-green-50 text-green-900',
        warning: 'border bg-amber-50 text-amber-900',
        info: 'border bg-blue-50 text-blue-900',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export type ToastVariant = VariantProps<typeof toastVariants>['variant']

export interface ToastData {
  id: string
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

type ToastFn = ((props: Omit<ToastData, 'id'>) => void) & {
  success: (props: Omit<ToastData, 'id' | 'variant'>) => void
  error: (props: Omit<ToastData, 'id' | 'variant'>) => void
  warning: (props: Omit<ToastData, 'id' | 'variant'>) => void
  info: (props: Omit<ToastData, 'id' | 'variant'>) => void
}

interface ToastContextValue {
  toasts: ToastData[]
  addToast: (toast: Omit<ToastData, 'id'>) => void
  removeToast: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | undefined>(undefined)

export function useToast(): { toast: ToastFn } {
  const context = React.use(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }

  const { addToast } = context

  const toast = React.useMemo<ToastFn>(() => {
    const base = (props: Omit<ToastData, 'id'>) => addToast(props)
    return Object.assign(base, {
      success: (props: Omit<ToastData, 'id' | 'variant'>) =>
        base({ ...props, variant: 'success' }),
      error: (props: Omit<ToastData, 'id' | 'variant'>) =>
        base({ ...props, variant: 'destructive' }),
      warning: (props: Omit<ToastData, 'id' | 'variant'>) =>
        base({ ...props, variant: 'warning' }),
      info: (props: Omit<ToastData, 'id' | 'variant'>) =>
        base({ ...props, variant: 'info' }),
    }) as ToastFn
  }, [addToast])

  return { toast }
}

export function PortalToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastData[]>([])

  const addToast = React.useCallback((t: Omit<ToastData, 'id'>) => {
    const id = Math.random().toString(36).slice(2, 11)
    const newToast: ToastData = { ...t, id }
    setToasts((prev) => [...prev, newToast])

    const duration = t.duration ?? 5000
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id))
      }, duration)
    }
  }, [])

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <Toaster toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  )
}

function Toaster({
  toasts,
  removeToast,
}: {
  toasts: ToastData[]
  removeToast: (id: string) => void
}) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          toast={t}
          onRemove={removeToast}
        />
      ))}
    </div>
  )
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: ToastData
  onRemove: (id: string) => void
}) {
  return (
    <div className={toastVariants({ variant: toast.variant })}>
      <div className="flex-1">
        {toast.title && (
          <div className="font-semibold">{toast.title}</div>
        )}
        {toast.description && (
          <div className="text-sm opacity-90">{toast.description}</div>
        )}
      </div>
      {toast.action && (
        <button
          className="text-sm font-semibold underline"
          onClick={(e) => {
            e.stopPropagation()
            toast.action!.onClick()
            onRemove(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        className="shrink-0 rounded p-1 hover:bg-black/10"
        onClick={() => onRemove(toast.id)}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

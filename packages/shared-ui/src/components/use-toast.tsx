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

/*
 * The announcement semantics live here, on the path every application renders,
 * and not on `toast.tsx`'s `ToastViewport`, which nothing mounts.
 *
 * A toast is the one piece of feedback on this app that a screen reader user
 * cannot reach any other way: it is not focusable, it is not in the tab order,
 * and it deletes itself on a timer. If the live region is missing the message is
 * simply never spoken, so this is the whole fix and everything else is detail.
 *
 * The region is the `Toaster` container, and it renders even when empty. Both
 * halves of that matter. A live region that appears at the same instant as its
 * own content is frequently not announced at all, because assistive technology
 * has no earlier state to diff against; mounting it first is what makes the
 * polite announcement reliable. The empty container costs one unpopulated,
 * `fixed` div — no space, no pointer targets.
 *
 * Politeness belongs to the region rather than to the update, so a single
 * region cannot choose per message: everything lands in a polite queue here,
 * and a `destructive` toast nests its own `role="alert"` to interrupt. That is
 * the only variant that means "something failed", and it is the only one whose
 * reader should hear it now instead of after the next pause. The trade is that
 * a few screen readers speak a destructive toast twice — interrupting, then as
 * the polite region's own addition — which is the safe direction to fail in:
 * a duplicate failure message is a nuisance, an unheard one is the bug this
 * change exists to close.
 *
 * `aria-atomic="false"` on the region keeps two rapid toasts as two utterances;
 * the alert sets `aria-atomic="true"` so a title and its description read as
 * one message rather than two fragments. Auto-dismiss needs no attribute of its
 * own: `aria-relevant` already defaults to "additions text", which is what
 * stops a toast *disappearing* from being announced too.
 */
function Toaster({
  toasts,
  removeToast,
}: {
  toasts: ToastData[]
  removeToast: (id: string) => void
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2"
    >
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
  // `destructive` is the only variant that reports a failure, so it is the only
  // one that gets its own assertive region; everything else is announced by the
  // polite region this item lands in.
  const urgent = toast.variant === 'destructive'

  return (
    <div
      className={toastVariants({ variant: toast.variant })}
      role={urgent ? 'alert' : undefined}
      aria-live={urgent ? 'assertive' : undefined}
      aria-atomic={urgent ? 'true' : undefined}
    >
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
        // Without an explicit type this defaults to "submit", so rendering a
        // toast inside a form makes dismissing it submit that form.
        type="button"
        // The X icon carries no text, so without a label this control is
        // announced as nothing but "button". Naming it after the toast's own
        // title is what distinguishes one dismiss control from another when a
        // screen reader is cycling the tab order through a stack of toasts.
        aria-label={toast.title ? `Dismiss ${toast.title}` : "Dismiss notification"}
        className="shrink-0 rounded p-1 hover:bg-black/10"
        onClick={() => onRemove(toast.id)}
      >
        {/* The button is named by aria-label above; announcing the glyph too
            would double it up. */}
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  )
}

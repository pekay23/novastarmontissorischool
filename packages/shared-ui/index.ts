// ============================================================================
// Design System — Exports for all shared UI components
// ============================================================================

// Utils
export { cn } from './src/lib/utils'

// Theme
export { ThemeProvider, useTheme } from './src/components/theme-provider'

// Components
export { Button, buttonVariants, type ButtonProps } from './src/components/button'
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from './src/components/card'
export { Input } from './src/components/input'
export { Label } from './src/components/label'
export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './src/components/select'
export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableCaption } from './src/components/table'
export { Badge, badgeVariants, type BadgeProps } from './src/components/badge'
export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from './src/components/dialog'
export { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuGroup, DropdownMenuShortcut } from './src/components/dropdown-menu'
export { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from './src/components/form'
export { Checkbox } from './src/components/checkbox'
export { RadioGroup, RadioGroupItem } from './src/components/radio-group'
export { Switch } from './src/components/switch'
export { Textarea } from './src/components/textarea'
export { Separator } from './src/components/separator'
export { Skeleton } from './src/components/skeleton'
export { Avatar, AvatarFallback, AvatarImage } from './src/components/avatar'
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './src/components/tooltip'
export { Toast, ToastAction, ToastClose, ToastDescription, ToastFooter, ToastHeader, ToastTitle, ToastViewport } from './src/components/toast'
export { Alert, AlertDescription, AlertTitle, alertVariants, type AlertProps } from './src/components/alert'
export { Tabs, TabsContent, TabsList, TabsTrigger } from './src/components/tabs'
export { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './src/components/accordion'
export { NotFound, notFoundActionClasses, type NotFoundProps } from './src/components/not-found'
export {
  TimetableGrid,
  WEEKDAYS,
  sortTimetablePeriods,
  groupTimetablePeriods,
  type TimetablePeriod,
  type TimetableDay,
  type TimetableGridProps,
} from './src/components/timetable-grid'

// Toast
export {
  PortalToastProvider as ToastProvider,
  useToast,
  toastVariants,
} from './src/components/use-toast'
export type { ToastData, ToastVariant } from './src/components/use-toast'

// Confirm
export { ConfirmProvider, useConfirm } from './src/components/use-confirm'


// Constants
export { TENANCY_COLORS, GRADE_COLORS, ATTENDANCE_COLORS } from './src/lib/constants'

// Types
export type { Theme } from './src/components/theme-provider'
'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, Button, Input, Label, Select, SelectContent,
  SelectItem, SelectTrigger, SelectValue, Alert, AlertTitle,
  AlertDescription, useToast,
} from '@novastar/shared-ui'
import { Check, X, Mail, MailWarning } from 'lucide-react'

/**
 * One dialog, two jobs: create a staff member with a login, or edit one that
 * already has both.
 *
 * WHY CREATE AND EDIT SHARE A FORM
 * --------------------------------
 * They already did, and splitting them would mean two differently-styled dialogs
 * collecting the same names. What actually differs is which endpoint receives the
 * body, and that is the only thing `isEditing` decides.
 *
 * CREATE POSTS TO `/api/teachers/invite`, NOT TO `/api/teachers`
 * ---------------------------------------------------------------
 * `POST /api/teachers` writes a `Staff` row whose `userId` must already exist,
 * which nobody could satisfy: there was no way to create the login it demands.
 * That is why this form used to be unable to create anybody at all — it also
 * never sent the `employeeId` that endpoint's schema requires.
 *
 * The invite route creates the `User` and the `Staff` row in one transaction and
 * emails a one-time setup link, so there is no half-made person to clean up. It
 * refuses a body carrying a `userId`, `tenantId`, `schoolId`, `roleId` or
 * `password`, so nothing below sends one.
 *
 * THE ROLE DROPDOWN IS FED BY THE SERVER
 * --------------------------------------
 * `grantableRoleNames` comes from the capability endpoint, which derives it from
 * the same `ROLE_GRANT_RANK` the route enforces. It is not filtered from a list
 * of role names held in this file: a second copy of that ordering is how the two
 * drift, and a dropdown offering a role the server will refuse teaches the user
 * that the refusal is a glitch. A delegation can also grant the key this form
 * needs without the caller's role name saying so, which is the other reason the
 * capability comes from the server rather than from the session.
 *
 * THE OLD `roleId` SELECT IS GONE
 * -------------------------------
 * It listed whatever `/api/config/roles` returned — which is not an entity in
 * `ENTITY_CONFIG_MAP`, so that request is a 404 and the list was always empty
 * except for its own hard-coded "No role" entry. Neither `POST /api/teachers` nor
 * `PATCH /api/teachers/[id]` reads `roleId` either. It was a control that could
 * not do anything, sitting next to the one that can.
 */
export interface StaffCreateResult {
  /** Whether the setup email actually left the building. */
  delivered: boolean
  /** Who it was for, so the caller can name the person in a message. */
  email: string
}

interface StaffFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editId?: string | null
  /** Portal roles this caller may grant. From the server; never derived here. */
  grantableRoleNames: string[]
  onSuccess: (result?: StaffCreateResult) => void
}

interface StaffFormState {
  firstName: string
  lastName: string
  otherNames: string
  phone: string
  email: string
  hireDate: string
  employeeId: string
  gender: 'MALE' | 'FEMALE' | 'OTHER'
  roleName: string
}

const EMPTY: StaffFormState = {
  firstName: '',
  lastName: '',
  otherNames: '',
  phone: '',
  email: '',
  hireDate: '',
  employeeId: '',
  gender: 'OTHER',
  roleName: '',
}

export function StaffForm({
  open,
  onOpenChange,
  editId,
  grantableRoleNames,
  onSuccess,
}: StaffFormProps) {
  const { toast } = useToast()
  const [form, setForm] = useState<StaffFormState>(EMPTY)
  const [loading, setLoading] = useState(false)
  const isEditing = Boolean(editId)

  useEffect(() => {
    if (!open) return
    const load = async () => {
      setLoading(true)
      if (editId) {
        const res = await fetch(`/api/teachers/${editId}`)
        const staff = res.ok ? await res.json() : null
        if (staff) {
          setForm({
            firstName: staff.firstName || '',
            lastName: staff.lastName || '',
            otherNames: staff.otherNames || '',
            phone: staff.phone || '',
            email: staff.email || '',
            hireDate: staff.hireDate ? new Date(staff.hireDate).toISOString().split('T')[0] : '',
            // Not editable here. `PATCH /api/teachers/[id]` accepts the contact
            // fields only, so a control that appeared to write them would be a lie.
            employeeId: staff.employeeId || '',
            gender: (staff.gender ?? 'OTHER') as StaffFormState['gender'],
            roleName: '',
          })
        }
      } else {
        setForm(EMPTY)
      }
      setLoading(false)
    }
    load()
  }, [open, editId])

  const handleChange = (field: keyof StaffFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (isEditing) {
        const res = await fetch(`/api/teachers/${editId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: form.firstName,
            lastName: form.lastName,
            otherNames: form.otherNames || undefined,
            phone: form.phone,
            email: form.email,
          }),
        })
        if (!res.ok) {
          const data = await res.json()
          toast.error({ title: 'Error', description: data.error || 'Failed to save' })
          return
        }
        toast.success({ title: 'Success', description: 'Staff member updated' })
        onOpenChange(false)
        onSuccess()
        return
      }

      const res = await fetch('/api/teachers/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          otherNames: form.otherNames || undefined,
          gender: form.gender,
          phone: form.phone,
          email: form.email,
          hireDate: form.hireDate,
          employeeId: form.employeeId,
          roleName: form.roleName,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        toast.success({
          title: 'Staff member invited',
          description: `${data.email ?? form.email} can now set their own password from the email that was just sent.`,
        })
        onOpenChange(false)
        onSuccess({ delivered: true, email: data.email ?? form.email })
        return
      }

      const data = await res.json()

      // The account exists and the setup email did not go out. Distinct from every
      // other failure and distinct from success, so the dialog closes and the page
      // says so in destructive styling — retrying is pointless, because the address
      // is now taken, and the recovery is a password-reset request by the recipient.
      if (data.status === 'created-not-delivered') {
        const email = data.email ?? form.email
        toast.warning({
          title: 'Account created, email not sent',
          description: `${email} has no setup link. See the notice on the page.`,
          // Long enough to read and act on, unlike the default five seconds.
          duration: 12000,
        })
        onOpenChange(false)
        onSuccess({ delivered: false, email })
        return
      }

      toast.error({ title: 'Error', description: data.error || 'Failed to create staff member' })
    } catch {
      toast.error({ title: 'Error', description: 'Failed to save' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Staff' : 'Add New Staff'}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update staff information'
                : 'Create a staff record and a portal login they can use straight away'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Standing context, not an error, so `role="note"`: shared-ui's Alert
                carries `role="alert"` by default and spreading a later attribute
                over it is what changes that. */}
            {!isEditing && (
              <Alert role="note">
                <Mail className="h-4 w-4" />
                <AlertTitle>They will set their own password</AlertTitle>
                <AlertDescription>
                  <p>
                    This creates the staff record and a portal login in one go, and{' '}
                    <strong>{form.email || 'they'}</strong> receives a one-time link to
                    choose a password. The link expires in 24 hours.
                  </p>
                  <p className="mt-2">
                    No password is generated or emailed, so nothing is left in a
                    mailbox to rotate. If the email cannot be sent, the account is still
                    created and you will be told, rather than being left to assume it
                    arrived.
                  </p>
                </AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={(e) => handleChange('firstName', e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={(e) => handleChange('lastName', e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="otherNames">Other Names</Label>
              <Input
                id="otherNames"
                value={form.otherNames}
                onChange={(e) => handleChange('otherNames', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="phone">Phone *</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  required
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  The login is created at this address. It is also what the setup link
                  is sent to.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="hireDate">Hire Date *</Label>
                <Input
                  id="hireDate"
                  type="date"
                  value={form.hireDate}
                  onChange={(e) => handleChange('hireDate', e.target.value)}
                  required={!isEditing}
                  disabled={isEditing}
                />
              </div>
              <div>
                <Label htmlFor="employeeId">Employee ID *</Label>
                <Input
                  id="employeeId"
                  value={form.employeeId}
                  onChange={(e) => handleChange('employeeId', e.target.value)}
                  required={!isEditing}
                  disabled={isEditing}
                />
              </div>
            </div>

            {/* Gender and portal role are create-only, because
                `PATCH /api/teachers/[id]` accepts neither. Showing them while
                editing would promise a write that does not happen. */}
            {!isEditing && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="gender">Gender *</Label>
                  <Select
                    value={form.gender}
                    onValueChange={(v) => handleChange('gender', v)}
                  >
                    <SelectTrigger id="gender">
                      <SelectValue placeholder="Select a gender" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FEMALE">Female</SelectItem>
                      <SelectItem value="MALE">Male</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="roleName">Portal Role *</Label>
                  <Select
                    value={form.roleName || undefined}
                    onValueChange={(v) => handleChange('roleName', v)}
                  >
                    <SelectTrigger id="roleName">
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {grantableRoleNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name.replace(/_/g, ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    What they can do once signed in. You can only grant a role at or
                    below your own.
                  </p>
                </div>
              </div>
            )}

            {/* Redundant with the notice above, and deliberately so: it is the one
                thing a user who skims the dialog most needs to not miss, and it sits
                next to the button that commits the write. */}
            {!isEditing && form.email.trim() !== '' && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <MailWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  On save, a setup link is emailed to{' '}
                  <strong className="text-foreground">{form.email}</strong>. The person
                  chooses their own password from it.
                </span>
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : isEditing ? 'Update' : 'Create & Invite'}
              {!loading && <Check className="h-4 w-4 ml-2" />}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
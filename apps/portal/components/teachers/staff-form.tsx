'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, Button, Input, Label, Select, SelectContent,
  SelectItem, SelectTrigger, SelectValue, useToast,
} from '@novastar/shared-ui'
import { Check, X } from 'lucide-react'

interface StaffFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editId?: string | null
  onSuccess: () => void
}

interface StaffForm {
  firstName: string
  lastName: string
  otherNames: string
  phone: string
  email: string
  hireDate: string
  roleId: string
}

export function StaffForm({ open, onOpenChange, editId, onSuccess }: StaffFormProps) {
  const { toast } = useToast()
  const [form, setForm] = useState<StaffForm>({
    firstName: '',
    lastName: '',
    otherNames: '',
    phone: '',
    email: '',
    hireDate: '',
    roleId: '',
  })
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    if (open) {
      const loadRoles = async () => {
        const res = await fetch('/api/config/roles')
        const data = res.ok ? await res.json() : { data: [] }
        setRoles(data.data || [])
      }
      loadRoles()
    }
  }, [open])

  useEffect(() => {
    const load = async () => {
      if (open && editId) {
        setIsEditing(true)
        setLoading(true)
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
            roleId: staff.roleId || '',
          })
        }
        setLoading(false)
      } else if (open && !editId) {
        setIsEditing(false)
        setForm({
          firstName: '',
          lastName: '',
          otherNames: '',
          phone: '',
          email: '',
          hireDate: '',
          roleId: '',
        })
      }
    }
    if (open) load()
  }, [open, editId])

  const handleChange = (field: keyof StaffForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const body = {
        firstName: form.firstName,
        lastName: form.lastName,
        otherNames: form.otherNames || undefined,
        gender: 'OTHER' as const,
        phone: form.phone,
        email: form.email,
        hireDate: form.hireDate,
        roleId: form.roleId || undefined,
      }

      const url = isEditing ? `/api/teachers/${editId}` : '/api/teachers'
      const method = isEditing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success({
          title: 'Success',
          description: isEditing ? 'Staff member updated' : 'Staff member created',
        })
        onOpenChange(false)
        onSuccess()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to save' })
      }
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
              {isEditing ? 'Update staff information' : 'Enter staff details to create a new member'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={e => handleChange('firstName', e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={e => handleChange('lastName', e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <Label htmlFor="otherNames">Other Names</Label>
              <Input
                id="otherNames"
                value={form.otherNames}
                onChange={e => handleChange('otherNames', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="phone">Phone *</Label>
                <Input
                  id="phone"
                  value={form.phone}
                  onChange={e => handleChange('phone', e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={e => handleChange('email', e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="hireDate">Hire Date *</Label>
                <Input
                  id="hireDate"
                  type="date"
                  value={form.hireDate}
                  onChange={e => handleChange('hireDate', e.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor="roleId">Role</Label>
                <Select value={form.roleId || undefined} onValueChange={v => handleChange('roleId', v)}>
                  <SelectTrigger id="roleId">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No role</SelectItem>
                    {roles.map(r => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : isEditing ? 'Update' : 'Create'}
              {!loading && <Check className="h-4 w-4 ml-2" />}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

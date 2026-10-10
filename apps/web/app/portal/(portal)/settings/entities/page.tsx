'use client'

import { useState, useEffect } from 'react'
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
  Button, Input, Textarea, Badge, Switch, Label,
  useConfirm,
} from '@novastar/shared-ui'
import { DEFAULT_ENTITY_REGISTRY, type EntityDefinition } from '@novastar/shared-types'

interface EntityDefinitionWithState extends EntityDefinition {
  _id?: string
  _isOverridden: boolean
}

export default function EntityDefinitionsPage() {
  const [entities, setEntities] = useState<EntityDefinitionWithState[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const confirm = useConfirm()

  useEffect(() => {
    fetch('/portal/api/config/entities')
      .then(res => res.json())
      .then(data => {
        const merged = DEFAULT_ENTITY_REGISTRY.map(def => {
          const overridden = data.entityTypes?.find((e: { type: string; _isOverridden?: boolean }) => e.type === def.type)
          return overridden
            ? { ...def, ...overridden, _isOverridden: !!overridden._isOverridden }
            : { ...def, _isOverridden: false }
        })
        setEntities(merged)
      })
      .catch(() => {
        // Fallback to defaults if API fails
        setEntities(DEFAULT_ENTITY_REGISTRY.map(e => ({ ...e, _isOverridden: false })))
      })
      .finally(() => setLoading(false))
  }, [])

  const handleFieldChange = (type: string, field: string, value: unknown) => {
    setEntities(prev => prev.map(e =>
      e.type === type ? { ...e, [field]: value } : e
    ))
  }

  const handleSave = async (type: string) => {
    const entity = entities.find(e => e.type === type)
    if (!entity) return

    setSaving(s => ({ ...s, [type]: true }))
    try {
      const res = await fetch(`/portal/api/config/entities/${type}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: entity.type,
          name: entity.name,
          namePlural: entity.namePlural,
          description: entity.description,
          icon: entity.icon,
          color: entity.color,
          allowAdd: entity.allowAdd,
          allowEdit: entity.allowEdit,
          allowDelete: entity.allowDelete,
          allowImport: entity.allowImport,
          allowExport: entity.allowExport,
          hasPermissions: entity.hasPermissions,
          tenantScoped: entity.tenantScoped,
          auditTrail: entity.auditTrail,
          fields: entity.fields,
          defaultSortBy: entity.defaultSortBy,
          defaultSortOrder: entity.defaultSortOrder,
          searchFields: entity.searchFields,
          filterFields: entity.filterFields,
          groupBy: entity.groupBy,
          isActive: entity.isActive,
        }),
      })

      if (res.ok) {
        setEntities(prev => prev.map(e =>
          e.type === type ? { ...e, _isOverridden: true } : e
        ))
      }
    } catch (error) {
      console.error('Save error:', error)
    } finally {
      setSaving(s => ({ ...s, [type]: false }))
    }
  }

  const handleDelete = async (type: string) => {
    if (!await confirm({
      title: 'Reset to Default?',
      description: `Any custom overrides for "${type}" will be lost. This cannot be undone.`,
      confirmText: 'Reset',
      variant: 'destructive',
    })) return

    setSaving(s => ({ ...s, [type]: true }))
    try {
      const res = await fetch(`/portal/api/config/entities/${type}`, { method: 'DELETE' })
      if (res.ok) {
        setEntities(prev => prev.map(e =>
          e.type === type ? { ...DEFAULT_ENTITY_REGISTRY.find(d => d.type === type)!, _isOverridden: false } : e
        ))
      }
    } catch (error) {
      console.error('Delete error:', error)
    } finally {
      setSaving(s => ({ ...s, [type]: false }))
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-heading font-bold">Entity Definitions</h1>
        <p className="text-muted-foreground">Loading entity definitions…</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-heading font-bold">Entity Definitions</h1>
        <p className="text-muted-foreground">
          Manage configurable entity types. Edit display names, field definitions, and permissions.
          Changes take effect immediately for all admins.
        </p>
      </div>

      <div className="space-y-4">
        {entities.map(entity => (
          <Card key={entity.type}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {entity.icon && <span className="text-xl">{entity.icon}</span>}
                    {entity.name}
                    <Badge variant={entity._isOverridden ? 'default' : 'outline'}>
                      {entity._isOverridden ? 'Customized' : 'Default'}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Entity type: <code className="text-xs bg-muted px-1 py-0.5 rounded">{entity.type}</code>
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {entity._isOverridden && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(entity.type)}
                      disabled={saving[entity.type]}
                    >
                      Reset to Default
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => handleSave(entity.type)}
                    disabled={saving[entity.type]}
                  >
                    {saving[entity.type] ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label>Display Name</Label>
                <Input
                  value={entity.name}
                  onChange={e => handleFieldChange(entity.type, 'name', e.target.value)}
                />
              </div>
              <div>
                <Label>Plural Name</Label>
                <Input
                  value={entity.namePlural}
                  onChange={e => handleFieldChange(entity.type, 'namePlural', e.target.value)}
                />
              </div>
              <div>
                <Label>Icon</Label>
                <Input
                  value={entity.icon || ''}
                  onChange={e => handleFieldChange(entity.type, 'icon', e.target.value)}
                  placeholder="e.g. book-open"
                />
              </div>
              <div>
                <Label>Color</Label>
                <Input
                  value={entity.color || ''}
                  onChange={e => handleFieldChange(entity.type, 'color', e.target.value)}
                  placeholder="e.g. #ea580c"
                />
              </div>
              <div className="md:col-span-2">
                <Label>Description</Label>
                <Textarea
                  value={entity.description}
                  onChange={e => handleFieldChange(entity.type, 'description', e.target.value)}
                  rows={2}
                />
              </div>
              <div>
                <Label>Allow Add</Label>
                <Switch
                  checked={entity.allowAdd}
                  onCheckedChange={v => handleFieldChange(entity.type, 'allowAdd', v)}
                />
              </div>
              <div>
                <Label>Allow Edit</Label>
                <Switch
                  checked={entity.allowEdit}
                  onCheckedChange={v => handleFieldChange(entity.type, 'allowEdit', v)}
                />
              </div>
              <div>
                <Label>Allow Delete</Label>
                <Switch
                  checked={entity.allowDelete}
                  onCheckedChange={v => handleFieldChange(entity.type, 'allowDelete', v)}
                />
              </div>
              <div>
                <Label>Requires Permissions</Label>
                <Switch
                  checked={entity.hasPermissions}
                  onCheckedChange={v => handleFieldChange(entity.type, 'hasPermissions', v)}
                />
              </div>
              <div>
                <Label>Active</Label>
                <Switch
                  checked={entity.isActive}
                  onCheckedChange={v => handleFieldChange(entity.type, 'isActive', v)}
                />
              </div>
              <div className="md:col-span-3">
                <Label>Fields ({entity.fields.length})</Label>
                <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
                  {entity.fields.map(field => (
                    <div key={field.key} className="flex items-center gap-3 text-sm">
                      <code className="bg-muted px-2 py-1 rounded">{field.key}</code>
                      <span className="text-muted-foreground">{field.label}</span>
                      <Badge variant="secondary" className="text-xs">{field.type}</Badge>
                      {field.required && <Badge variant="outline" className="text-xs">required</Badge>}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Field definitions can only be modified by editing the config-schema.ts in the shared-types package.
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

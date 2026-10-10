'use client'

import { useState, useEffect } from 'react'
import {
  Card, CardContent, CardHeader, CardTitle, Button,
  useToast, useConfirm,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem,
} from '@novastar/shared-ui'
import { Search, BookOpen, MoreHorizontal, Edit2, Trash2 } from 'lucide-react'

interface Assessment {
  id: string
  name: string
  maxScore: string
  weight: string
  assessmentDate: string
  isPublished: boolean
  type: { name: string } | null
  classSubject: {
    subject: { name: string } | null
    class: { name: string } | null
  } | null
}

export default function GradesPage() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const fetchAssessments = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await fetch(`/api/assessments?${params}`)
      if (res.ok) {
        const data = await res.json()
        setAssessments(data.data || [])
      } else {
        toast.error({ title: 'Error', description: 'Failed to load assessments' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load assessments' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const load = async () => {
      await fetchAssessments()
    }
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (a: Assessment) => {
    const ok = await confirm({
      title: 'Delete Assessment?',
      description: `This will permanently delete "${a.name}". This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      const res = await fetch(`/api/assessments/${a.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success({ title: 'Success', description: 'Assessment deleted' })
        fetchAssessments()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to delete' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to delete' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Grades</h1>
          <p className="text-sm text-muted-foreground">Manage assessments and score entry</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search assessments..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            if (e.target.value.length >= 2 || e.target.value.length === 0) {
              fetchAssessments()
            }
          }}
          className="pl-10 pr-4 py-2 border rounded-md w-full"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assessments ({assessments.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : assessments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No assessments found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Assessment</th>
                    <th className="text-left py-2">Subject</th>
                    <th className="text-left py-2">Class</th>
                    <th className="text-left py-2">Type</th>
                    <th className="text-left py-2">Max Score</th>
                    <th className="text-left py-2">Date</th>
                    <th className="w-12" />
                  </tr>
                </thead>
                <tbody>
                  {assessments.map((a) => (
                    <tr key={a.id} className="border-t">
                      <td className="py-2 font-medium">{a.name}</td>
                      <td className="py-2 text-sm">{a.classSubject?.subject?.name || 'N/A'}</td>
                      <td className="py-2 text-sm">{a.classSubject?.class?.name || 'N/A'}</td>
                      <td className="py-2 text-sm">{a.type?.name || 'N/A'}</td>
                      <td className="py-2 text-sm">{Number(a.maxScore)}</td>
                      <td className="py-2 text-sm text-muted-foreground">
                        {a.assessmentDate ? new Date(a.assessmentDate).toLocaleDateString() : '-'}
                      </td>
                      <td className="py-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => window.open(`/grades/${a.id}/scores`, '_blank')}
                            >
                              <Edit2 className="h-4 w-4 mr-2" />
                              Enter Scores
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDelete(a)}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
  Button, Badge, useToast,
  Input,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@novastar/shared-ui'
import { Search, Save, BookOpen, MoreHorizontal } from 'lucide-react'
import Link from 'next/link'

interface Student {
  id: string
  firstName: string
  lastName: string
  studentId: string | null
}

interface Score {
  id: string
  studentId: string
  student: Student
  rawScore: number | null
  percentage: number | null
  grade: string | null
  isApproved: boolean
  notes: string | null
}

interface Assessment {
  id: string
  name: string
  maxScore: number
  weight: number
  assessmentDate: string
  isPublished: boolean
  type: { name: string; code: string } | null
  classSubject: {
    subject: { name: string; code: string } | null
    class: { name: string } | null
  } | null
}

const gradeColors: Record<string, string> = {
  A: 'bg-green-100 text-green-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-amber-100 text-amber-800',
  D: 'bg-orange-100 text-orange-800',
  F: 'bg-red-100 text-red-800',
}

const gradeBadgeClass = (grade: string | null): string => {
  if (!grade) return ''
  const upper = grade.toUpperCase()
  return gradeColors[upper] || 'bg-gray-100 text-gray-800'
}

export default function GradesScorePage({ params }: { params: Promise<{ id: string }> }) {
  const { toast } = useToast()

  const [assessmentId, setAssessmentId] = useState<string | null>(null)
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [scores, setScores] = useState<Score[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const fetchStudents = useCallback(async (classId: string) => {
    try {
      const res = await fetch(`/api/classes/${classId}`)
      if (res.ok) {
        const data = await res.json()
        const studentsWithIds = (data.students || []).map((s: { id: string; firstName: string; lastName: string; studentId: string | null }) => ({
          id: s.id,
          firstName: s.firstName,
          lastName: s.lastName,
          studentId: s.studentId,
        }))
        setStudents(studentsWithIds)
      }
    } catch {
      // silently fail
    }
  }, [])

  const fetchScores = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/assessments/${id}/scores`)
      if (res.ok) {
        const data = await res.json()
        const mappedScores = (data.scores || []).map((s: { 
          id: string; 
          studentId: string; 
          student: Student; 
          rawScore: number | null; 
          percentage: number | null; 
          grade: string | null; 
          isApproved: boolean; 
          notes: string | null 
        }) => ({
          id: s.id,
          studentId: s.studentId,
          student: s.student,
          rawScore: s.rawScore,
          percentage: s.percentage,
          grade: s.grade,
          isApproved: s.isApproved,
          notes: s.notes,
        }))
        setScores(mappedScores)
      }
    } catch {
      // silently fail
    }
  }, [])

  const fetchAssessment = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/assessments/${id}`)
      if (res.ok) {
        const data = await res.json()
        setAssessment(data)
        if (data.classSubject?.class?.id) {
          await fetchStudents(data.classSubject.class.id)
        }
        await fetchScores(id)
      } else {
        toast.error({ title: 'Error', description: 'Failed to load assessment' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load assessment' })
    } finally {
      setLoading(false)
    }
  }, [toast, fetchStudents, fetchScores])

  useEffect(() => {
    const init = async () => {
      const { id } = await params
      setAssessmentId(id)
      await fetchAssessment(id)
    }
    init()
  }, [params, fetchAssessment])

  const handleSaveScore = async (studentId: string, rawScore: number, notes: string) => {
    if (!assessment) return
    const maxScore = Number(assessment.maxScore)
    if (rawScore < 0 || rawScore > maxScore) {
      toast.error({ title: 'Invalid Score', description: `Score must be between 0 and ${maxScore}` })
      return
    }

    try {
      const res = await fetch(`/api/assessments/${assessmentId}/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, rawScore, notes }),
      })

      if (res.ok) {
        const data = await res.json()
        const newScore = data.score
        // Reflect what the API returned — including the derived
        // percentage and grade band — rather than recomputing locally.
        const percentage = newScore.percentage ?? (rawScore / maxScore) * 100

        setScores(prev => {
          const existing = prev.find(s => s.studentId === studentId)
          if (existing) {
            return prev.map(s => s.studentId === studentId ? {
              ...s,
              rawScore: newScore.rawScore,
              percentage,
              grade: newScore.grade ?? null,
              notes: newScore.notes,
            } : s)
          } else {
            return [...prev, {
              id: newScore.id,
              studentId,
              student: students.find(s => s.id === studentId)!,
              rawScore: newScore.rawScore,
              percentage,
              grade: newScore.grade ?? null,
              isApproved: false,
              notes: newScore.notes,
            }]
          }
        })
        toast.success({ title: 'Success', description: 'Score saved' })
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to save score' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to save score' })
    }
  }

  const handleBulkSave = async () => {
    setSaving(true)
    try {
      const results = []
      for (const student of students) {
        const score = scores.find(s => s.studentId === student.id)
        if (score && score.rawScore !== null) {
          const res = await fetch(`/api/assessments/${assessmentId}/scores`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              studentId: student.id,
              rawScore: score.rawScore,
              notes: score.notes || undefined,
            }),
          })
          results.push({ studentId: student.id, success: res.ok })
        }
      }
      toast.success({ title: 'Success', description: 'Bulk save completed' })
      await fetchScores(assessmentId!)
    } catch {
      toast.error({ title: 'Error', description: 'Failed to bulk save' })
    } finally {
      setSaving(false)
    }
  }

  const filteredStudents = students.filter(s =>
    `${s.firstName} ${s.lastName} ${s.studentId || ''}`.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/grades">&larr; Back to Grades</Link>
        </Button>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!assessment) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/grades">&larr; Back to Grades</Link>
        </Button>
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Assessment not found.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const maxScore = Number(assessment.maxScore)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/grades">&larr; Back to Grades</Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleBulkSave} disabled={saving || students.length === 0}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving All...' : 'Save All Scores'}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Enter Scores
          </CardTitle>
          <CardDescription>
            {assessment.name} • {assessment.classSubject?.subject?.name || 'N/A'} • {assessment.classSubject?.class?.name || 'N/A'}
            <br />
            Max Score: {maxScore} • Weight: {assessment.weight} • Type: {assessment.type?.name || 'N/A'}
            <br />
            Date: {assessment.assessmentDate ? new Date(assessment.assessmentDate).toLocaleDateString() : '—'}
            {assessment.isPublished && <Badge variant="default" className="ml-2">Published</Badge>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search students..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border rounded-md w-full max-w-xs"
            />
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Student ID</TableHead>
                  <TableHead className="text-right w-24">Score / {maxScore}</TableHead>
                  <TableHead className="text-right w-20">%</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStudents.map((student) => {
                  const score = scores.find(s => s.studentId === student.id)
                  const rawScore = score?.rawScore ?? null
                  const percentage = score?.percentage !== null && score?.percentage !== undefined
                    ? score.percentage
                    : (rawScore !== null ? Math.round((rawScore / maxScore) * 1000) / 10 : null)

                  return (
                    <TableRow key={student.id}>
                      <TableCell className="font-medium">
                        {student.firstName} {student.lastName}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {student.studentId || '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            max={maxScore}
                            step={0.5}
                            value={rawScore !== null ? String(rawScore) : ''}
                            onChange={(e) => {
                              const val = e.target.value === '' ? null : parseFloat(e.target.value)
                              if (val !== null) {
                                handleSaveScore(student.id, val, score?.notes || '')
                              }
                            }}
                            placeholder="Score"
                            className="w-24"
                          />
                          <span className="text-muted-foreground">/ {maxScore}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {percentage !== null ? `${percentage.toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell>
                        {score?.grade ? (
                          <Badge className={gradeBadgeClass(score.grade)}>
                            {score.grade}
                          </Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <Input
                          value={score?.notes || ''}
                          onChange={(e) => {
                            if (score) {
                              const newScore = { ...score, notes: e.target.value }
                              setScores(prev => prev.map(s => s.studentId === student.id ? newScore : s))
                            }
                          }}
                          placeholder="Notes"
                        />
                      </TableCell>
                      <TableCell>
                        {score && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => handleSaveScore(student.id, score.rawScore!, score.notes || '')}
                                disabled={score.rawScore === null}
                              >
                                <Save className="h-4 w-4 mr-2" />
                                Save
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {filteredStudents.length === 0 && students.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No students found for this class</p>
            </div>
          )}

          {filteredStudents.length === 0 && students.length > 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Search className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No students match your search</p>
            </div>
          )}

          {/* Summary Stats */}
          <div className="mt-6 grid grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardDescription>Total Students</CardDescription>
                <CardTitle>{students.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Graded</CardDescription>
                <CardTitle>{scores.filter(s => s.rawScore !== null).length}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Pending</CardDescription>
                <CardTitle>{students.length - scores.filter(s => s.rawScore !== null).length}</CardTitle>
              </CardHeader>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
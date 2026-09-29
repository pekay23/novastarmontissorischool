'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  useToast,
  useConfirm,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Label,
  Input,
  Textarea,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@novastar/shared-ui'
import { LoanStatus } from '@novastar/database'
import {
  Plus,
  Search,
  MoreHorizontal,
  Edit2,
  Trash2,
  Save,
  X,
  BookOpen,
  Calendar,
  User,
} from 'lucide-react'

interface Book {
  id: string
  title: string
  author: string | null
  isbn: string | null
  publisher: string | null
  publishYear: number | null
  category: { name: string } | null
  totalCopies: number
  availableCopies: number
  shelfLocation: string | null
  language: string | null
  edition: string | null
  description: string | null
  createdAt: string
  updatedAt: string
  bookLoans: Array<{
    id: string
    status: LoanStatus
    dueDate: string
    student: { firstName: string; lastName: string; studentId: string } | null
    staff: { firstName: string; lastName: string } | null
  }>
}

interface BookForm {
  title: string
  author: string
  isbn: string
  publisher: string
  publishYear: string
  shelfLocation: string
  language: string
  edition: string
  description: string
  totalCopies: string
}

const LOAN_STATUS_COLORS: Record<LoanStatus, string> = {
  ACTIVE: 'bg-blue-100 text-blue-800',
  RETURNED: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-800',
  LOST: 'bg-gray-100 text-gray-800',
}

export default function LibraryPage() {
  const { toast } = useToast()
  const confirm = useConfirm()
  const [books, setBooks] = useState<Book[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingBook, setEditingBook] = useState<Book | null>(null)
  const [form, setForm] = useState<BookForm>({
    title: '',
    author: '',
    isbn: '',
    publisher: '',
    publishYear: '',
    shelfLocation: '',
    language: '',
    edition: '',
    description: '',
    totalCopies: '1',
  })

  const fetchBooks = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      const res = await fetch(`/api/library?${params}`)
      if (res.ok) {
        const data = await res.json()
        setBooks(data.data || [])
      } else {
        toast.error({ title: 'Error', description: 'Failed to load books' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to load books' })
    } finally {
      setLoading(false)
    }
  }, [search, toast])

  useEffect(() => {
    const load = async () => {
      await fetchBooks()
    }
    load()
  }, [fetchBooks])

  const handleNew = () => {
    setEditingBook(null)
    setForm({
      title: '',
      author: '',
      isbn: '',
      publisher: '',
      publishYear: '',
      shelfLocation: '',
      language: '',
      edition: '',
      description: '',
      totalCopies: '1',
    })
    setDialogOpen(true)
  }

  const handleEdit = (book: Book) => {
    setEditingBook(book)
    setForm({
      title: book.title,
      author: book.author || '',
      isbn: book.isbn || '',
      publisher: book.publisher || '',
      publishYear: book.publishYear ? String(book.publishYear) : '',
      shelfLocation: book.shelfLocation || '',
      language: book.language || '',
      edition: book.edition || '',
      description: book.description || '',
      totalCopies: String(book.totalCopies),
    })
    setDialogOpen(true)
  }

  const handleDelete = async (book: Book) => {
    if (book.bookLoans.some((l) => l.status === 'ACTIVE')) {
      toast.error({
        title: 'Error',
        description: 'Cannot delete book with active loans',
      })
      return
    }

    const ok = await confirm({
      title: 'Delete Book?',
      description: `This will permanently delete "${book.title}". This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      const res = await fetch(`/api/library/${book.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success({ title: 'Success', description: 'Book deleted' })
        void fetchBooks()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to delete book' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to delete book' })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!form.title.trim()) {
      toast.error({ title: 'Error', description: 'Title is required' })
      return
    }

    const body: Record<string, unknown> = {
      title: form.title,
      author: form.author || null,
      isbn: form.isbn || null,
      publisher: form.publisher || null,
      publishYear: form.publishYear ? Number(form.publishYear) : null,
      shelfLocation: form.shelfLocation || null,
      language: form.language || null,
      edition: form.edition || null,
      description: form.description || null,
      totalCopies: Number(form.totalCopies) || 1,
    }

    try {
      let res: Response
      if (editingBook) {
        res = await fetch(`/api/library/${editingBook.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch('/api/library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }

      if (res.ok) {
        toast.success({
          title: 'Success',
          description: editingBook ? 'Book updated' : 'Book created',
        })
        setDialogOpen(false)
        setEditingBook(null)
        void fetchBooks()
      } else {
        const data = await res.json()
        toast.error({ title: 'Error', description: data.error || 'Failed to save book' })
      }
    } catch {
      toast.error({ title: 'Error', description: 'Failed to save book' })
    }
  }

  const handleBorrow = async (book: Book) => {
    // In a full implementation, this would open a borrow dialog
    // For now, open a simple confirmation for borrowing
    toast.info({
      title: 'Borrow Book',
      description: `${book.title} has ${book.availableCopies} available copy/copies. Borrowing requires student/staff selection — coming soon.`,
    })
  }

  const getBookStatus = (book: Book) => {
    const activeLoans = book.bookLoans.filter((l) => l.status === 'ACTIVE')
    const overdueLoans = book.bookLoans.filter(
      (l) => l.status === 'ACTIVE' && new Date(l.dueDate) < new Date(),
    )

    if (overdueLoans.length > 0) {
      return { label: 'Overdue', variant: 'destructive' as const }
    }
    if (activeLoans.length > 0) {
      return { label: 'Checked Out', variant: 'default' as const }
    }
    if (book.availableCopies === 0) {
      return { label: 'Unavailable', variant: 'secondary' as const }
    }
    return { label: 'Available', variant: 'default' as const }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">Library</h1>
          <p className="text-sm text-muted-foreground">
            Manage library books, borrowing, and loans
          </p>
        </div>
        <Button className="gap-2" onClick={handleNew}>
          <Plus className="h-4 w-4" />
          New Book
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search books by title, author, ISBN..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 pr-4 py-2 border rounded-md w-full"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Books ({books.length})</CardTitle>
          <CardDescription>
            Total: {books.reduce((sum, b) => sum + b.totalCopies, 0)} copies |{' '}
            Available: {books.reduce((sum, b) => sum + b.availableCopies, 0)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : books.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No books found</p>
              <p className="text-sm mt-1">Click "New Book" to add one</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Title</th>
                    <th className="text-left py-2">Author</th>
                    <th className="text-left py-2">Category</th>
                    <th className="text-center py-2">Copies</th>
                    <th className="text-center py-2">Status</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody>
                  {books.map((book) => {
                    const bookStatus = getBookStatus(book)
                    const activeLoans = book.bookLoans.filter((l) => l.status === 'ACTIVE')
                    return (
                      <tr key={book.id} className="border-t">
                        <td className="py-2">
                          <div className="font-medium">{book.title}</div>
                          {book.isbn && (
                            <p className="text-xs text-muted-foreground">
                              ISBN: {book.isbn}
                            </p>
                          )}
                          {book.shelfLocation && (
                            <p className="text-xs text-muted-foreground">
                              Shelf: {book.shelfLocation}
                            </p>
                          )}
                        </td>
                        <td className="py-2 text-sm">
                          {book.author || '-'}
                        </td>
                        <td className="py-2 text-sm">
                          {book.category?.name || '-'}
                        </td>
                        <td className="py-2 text-center">
                          <span className="text-sm">
                            {book.availableCopies}/{book.totalCopies}
                          </span>
                        </td>
                        <td className="py-2 text-center">
                          <Badge variant={bookStatus.variant}>{bookStatus.label}</Badge>
                          {activeLoans.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {activeLoans.length} on loan
                            </p>
                          )}
                        </td>
                        <td className="py-2">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleBorrow(book)}>
                                <User className="h-4 w-4 mr-2" />
                                Borrow
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleEdit(book)}>
                                <Edit2 className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDelete(book)}
                                className="text-red-600 focus:text-red-600"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Checkouts / Active Loans */}
      <Card>
        <CardHeader>
          <CardTitle>Active Loans</CardTitle>
          <CardDescription>
            Currently checked-out books
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <div className="h-12 bg-muted animate-pulse rounded" />
              <div className="h-12 bg-muted animate-pulse rounded" />
            </div>
          ) : (
            (() => {
              const activeLoans = books.flatMap((b) =>
                b.bookLoans
                  .filter((l) => l.status === 'ACTIVE')
                  .map((l) => ({
                    bookTitle: b.title,
                    ...l,
                  })),
              )
              return activeLoans.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active loans.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Book</th>
                      <th className="text-left py-2">Borrower</th>
                      <th className="text-center py-2">Due Date</th>
                      <th className="text-center py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeLoans.map((loan) => {
                      const isOverdue =
                        new Date(loan.dueDate) < new Date()
                      const status = isOverdue ? 'OVERDUE' : loan.status
                      return (
                        <tr key={loan.id} className="border-t">
                          <td className="py-2">{loan.bookTitle}</td>
                          <td className="py-2">
                            {loan.student
                              ? `${loan.student.firstName} ${loan.student.lastName}`
                              : loan.staff
                                ? `${loan.staff.firstName} ${loan.staff.lastName}`
                                : '-'}
                          </td>
                          <td className="py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(loan.dueDate).toLocaleDateString()}
                            </div>
                          </td>
                          <td className="py-2 text-center">
                            <Badge
                              variant={
                                isOverdue ? 'destructive' : 'default'
                              }
                              className={LOAN_STATUS_COLORS[status]}
                            >
                              {status}
                            </Badge>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )
            })()
          )}
        </CardContent>
      </Card>

      {/* Book Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>{editingBook ? 'Edit Book' : 'New Book'}</DialogTitle>
            <DialogDescription>
              {editingBook
                ? 'Update book details below.'
                : 'Fill in the book details below.'}
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto max-h-[calc(90vh-160px)]">
            <form id="book-form" onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="author">Author</Label>
                  <Input
                    id="author"
                    value={form.author}
                    onChange={(e) => setForm({ ...form, author: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="isbn">ISBN</Label>
                  <Input
                    id="isbn"
                    value={form.isbn}
                    onChange={(e) => setForm({ ...form, isbn: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="publisher">Publisher</Label>
                  <Input
                    id="publisher"
                    value={form.publisher}
                    onChange={(e) => setForm({ ...form, publisher: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="publishYear">Publish Year</Label>
                  <Input
                    id="publishYear"
                    type="number"
                    value={form.publishYear}
                    onChange={(e) => setForm({ ...form, publishYear: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="totalCopies">Total Copies *</Label>
                  <Input
                    id="totalCopies"
                    type="number"
                    min="1"
                    value={form.totalCopies}
                    onChange={(e) => setForm({ ...form, totalCopies: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shelfLocation">Shelf Location</Label>
                  <Input
                    id="shelfLocation"
                    value={form.shelfLocation}
                    onChange={(e) => setForm({ ...form, shelfLocation: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="language">Language</Label>
                  <Input
                    id="language"
                    value={form.language}
                    onChange={(e) => setForm({ ...form, language: e.target.value })}
                    placeholder="e.g., English, Twi"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edition">Edition</Label>
                <Input
                  id="edition"
                  value={form.edition}
                  onChange={(e) => setForm({ ...form, edition: e.target.value })}
                  placeholder="e.g., 1st, 2nd, Revised"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
            </form>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button type="submit" form="book-form">
              <Save className="h-4 w-4 mr-2" />
              {editingBook ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

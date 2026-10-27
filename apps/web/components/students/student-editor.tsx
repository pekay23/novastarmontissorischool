'use client'
import { useRouter } from 'next/navigation'
import { StudentForm } from './student-form'

export function StudentEditor({ id }: { id?: string }) {
  const router = useRouter()
  const returnToDirectory = () => {
    router.push('/portal/students')
    router.refresh()
  }
  return (
    <StudentForm
      key={id ?? 'new'}
      editId={id}
      onCancel={returnToDirectory}
      onSuccess={returnToDirectory}
    />
  )
}

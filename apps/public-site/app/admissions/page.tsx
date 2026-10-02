import { AdmissionsForm } from '@/components/admissions-form'
import { generateAdmissionsMetadata } from '@/lib/metadata'

/*
 * Server Component: it owns the page's `metadata`, which Next resolves on the
 * server. The interactive multi-step form lives in `components/admissions-form`.
 *
 * The export is a plain object, not a re-exported function: aliasing a function
 * to the name `metadata` makes Next treat it as `generateMetadata` and call it
 * during prerendering, which fails the static export.
 */
export const metadata = generateAdmissionsMetadata()

export default function AdmissionsPage() {
  return (
    <div className="min-h-screen">
      <section className="bg-gradient-to-b from-primary/10 to-transparent py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-responsive-h1 font-heading text-primary mb-4">Admissions</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            We&apos;d love to welcome your child to our learning community. Apply online or
            contact us for more information.
          </p>
        </div>
      </section>

      <section className="section-y">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <h2 className="text-responsive-h2 font-heading text-primary mb-4">Admission Process</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Simple 4-step process to get your child enrolled at Novastar Montessori School.
            </p>
          </div>

          <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ProcessStep number="1" title="Apply Online" desc="Fill our online application form" />
            <ProcessStep number="2" title="Documents" desc="Submit required documents" />
            <ProcessStep number="3" title="Assessment" desc="Student assessment and interview" />
            <ProcessStep number="4" title="Enroll" desc="Receive acceptance and register" />
          </ol>
        </div>
      </section>

      <section className="section-y bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <AdmissionsForm />
          </div>
        </div>
      </section>
    </div>
  )
}

function ProcessStep({ number, title, desc }: { number: string; title: string; desc: string }) {
  return (
    <li className="rounded-lg border border-border bg-card p-4 text-center shadow-sm">
      <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">
        {number}
      </span>
      <h3 className="mb-1 font-semibold text-primary">{title}</h3>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </li>
  )
}
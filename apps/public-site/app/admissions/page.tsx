import { AdmissionsForm } from '@/components/admissions-form'
import { generateAdmissionsMetadata, SCHOOL_INFO } from '@/lib/metadata'
import { getAdmissionsStatus } from '@/lib/data'
import type { Metadata } from 'next'
import { Button, Card, CardContent } from '@novastar/shared-ui'

/*
 * Server Component: it owns the page's `metadata`, which Next resolves on the
 * server. The interactive multi-step form lives in `components/admissions-form`.
 *
 * The export is an async `generateMetadata` function, not a plain object.
 * `generateAdmissionsMetadata` now requires the `open` flag, which we fetch
 * at build time via `getAdmissionsStatus`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { open } = await getAdmissionsStatus()
  return generateAdmissionsMetadata(open)
}

export default async function AdmissionsPage() {
  const { open } = await getAdmissionsStatus()

  return (
    <div className="min-h-screen">
      <section className="bg-gradient-to-b from-primary/10 to-transparent py-16 md:py-20">
        <div className="container">
          <h1 className="text-responsive-h1 font-heading text-primary mb-4">Admissions</h1>
          {/* Branches with the rest of the page. Left unconditional it read
              "Apply online" in the hero while the panel directly below said
              applications were not being accepted — the same page contradicting
              itself, which is worse for a parent than either message alone. */}
          <p className="text-lg text-muted-foreground max-w-2xl">
            {open ? (
              <>
                We&apos;d love to welcome your child to our learning community. Apply online
                or contact us for more information.
              </>
            ) : (
              <>
                We&apos;d love to welcome your child to our learning community. Admissions
                are not open right now — contact us to hear about the next intake.
              </>
            )}
          </p>
        </div>
      </section>

      {open ? (
        <>
          <section className="section-y">
            <div className="container">
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
            <div className="container">
              <div className="mx-auto max-w-3xl">
                <AdmissionsForm />
              </div>
            </div>
          </section>
        </>
      ) : (
        <section className="section-y bg-muted/30">
          <div className="container">
            <div className="mx-auto max-w-2xl text-center">
              <Card className="border-border bg-card">
                <CardContent className="pt-6 pb-8 px-6 md:px-10">
                  <h2 className="text-responsive-h2 font-heading text-primary mb-4">Admissions currently closed</h2>
                  <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
                    We are not accepting applications at this time. The next intake window will
                    be announced here and on our social channels.
                  </p>
                  <div className="flex flex-col items-center gap-4">
                    <Button size="lg" asChild>
                      <a href="/contact" className="w-full sm:w-auto">
                        Contact us to enquire
                      </a>
                    </Button>
                    <a
                      href={`tel:${SCHOOL_INFO.phoneHref}`}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Or call us at {SCHOOL_INFO.phone}
                    </a>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      )}
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
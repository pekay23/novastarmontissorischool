import { Banknote, Landmark, Smartphone, type LucideIcon } from 'lucide-react'
import { getFeeSchedule, type FeeScheduleGroup } from '@/lib/data'
import { generateFeesMetadata } from '@/lib/metadata'

export const metadata = generateFeesMetadata()

/*
 * Amounts come from the database. This page previously carried hardcoded prices
 * (₵ 850 KG1 tuition, ₵ 1,800 JHS, a "5% late payment penalty after 10 days",
 * "Term 1: September – December 2026") that read as the school's published
 * schedule but were placeholders. Parents budget from these numbers, so they must
 * come from one real source or not be shown at all.
 *
 * `getFeeSchedule` returns `[]` without a database, so the empty state below ships
 * until real fee structures are loaded.
 */
export default async function FeesPage() {
  const schedule = await getFeeSchedule()

  return (
    <div className="min-h-screen">
      <section className="bg-gradient-to-b from-primary/10 to-transparent py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-responsive-h1 font-heading text-primary mb-4">Fee Structure</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Transparent, competitive fees offering excellent value for quality education.
          </p>
        </div>
      </section>

      <section className="section-y">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {schedule.length === 0 ? (
            <div className="mx-auto max-w-2xl rounded-xl border border-border bg-surface p-10 text-center">
              <h2 className="mb-2 font-heading text-xl font-semibold text-primary">
                Fee schedule not published yet
              </h2>
              <p className="text-muted-foreground">
                Current fees, due dates and payment terms are shared directly by the
                school office. Call or visit us and we will walk you through the
                schedule for your child&rsquo;s class.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {schedule.map((group) => (
                <FeeCategoryCard key={group.levelId} group={group} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section-y bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-responsive-h2 font-heading text-primary text-center mb-4">
            Payment Methods
          </h2>
          <p className="text-center text-muted-foreground mb-8 max-w-2xl mx-auto">
            We accept multiple payment methods for your convenience.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
            <PaymentMethodCard
              title="MTN Mobile Money"
              description="Pay using MTN MoMo app or USSD *170#"
              icon={Smartphone}
            />
            <PaymentMethodCard
              title="Bank Transfer"
              description="Transfer to our school bank account"
              icon={Landmark}
            />
            <PaymentMethodCard
              title="Cash at School"
              description="Pay in cash at our school office during operating hours"
              icon={Banknote}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

function FeeCategoryCard({ group }: { group: FeeScheduleGroup }) {
  return (
    <div className="border border-border rounded-lg p-6">
      <div className="mb-4">
        <h2 className="text-2xl font-heading font-semibold text-primary">{group.title}</h2>
        <p className="text-sm text-muted-foreground">{group.subtitle}</p>
      </div>
      {/*
        <caption> is not decorative here: a screen reader user landing on one of
        several tables needs to know which programme it belongs to.
      */}
      <table className="w-full text-sm">
        <caption className="sr-only">Fees for {group.title}</caption>
        <thead>
          <tr className="border-b">
            <th scope="col" className="text-left py-2">
              Item
            </th>
            <th scope="col" className="text-right py-2">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {group.items.map((fee, i) => (
            <tr key={`${fee.item}-${i}`} className="border-b border-border/30">
              <th scope="row" className="py-2 text-left font-normal">
                {fee.item}
                {!fee.mandatory && (
                  <span className="ml-2 text-xs text-muted-foreground">(optional)</span>
                )}
              </th>
              <td className="text-right py-2">{fee.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PaymentMethodCard({
  title,
  description,
  icon: Icon,
}: {
  title: string
  description: string
  icon: LucideIcon
}) {
  return (
    <div className="text-center rounded-lg border border-border bg-card p-6 shadow-sm">
      <Icon className="mx-auto mb-3 h-8 w-8 text-primary" aria-hidden="true" />
      <h3 className="mb-2 font-semibold text-primary">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
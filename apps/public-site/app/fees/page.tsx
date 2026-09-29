
import { Button } from '@novastar/shared-ui'
import { metadata } from '@/lib/metadata'

export { metadata }

export default function FeesPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="bg-gradient-to-b from-primary/10 to-transparent py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <h1 className="text-responsive-h1 font-heading text-primary mb-4">Fee Structure</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Transparent, competitive fees offering excellent value for quality education.
          </p>
        </div>
      </section>

      {/* Fee Overview */}
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-8">
            <FeeCategoryCard
              title="Kindergarten"
              subtitle="KG1, KG2"
              fees={[
                { item: 'Tuition (per term)', amount: '₵ 850' },
                { item: 'Registration Fee (one-time)', amount: '₵ 200' },
                { item: 'Books & Materials', amount: '₵ 400' },
                { item: 'Uniform', amount: '₵ 250' },
              ]}
              total="₵ 850/term"
            />
            <FeeCategoryCard
              title="Lower Primary"
              subtitle="B1, B2, B3"
              fees={[
                { item: 'Tuition (per term)', amount: '₵ 1,200' },
                { item: 'Books & Materials', amount: '₵ 500' },
                { item: 'Uniform', amount: '₵ 250' },
                { item: 'Activity Fee', amount: '₵ 300' },
              ]}
              total="₵ 1,200/term"
            />
            <FeeCategoryCard
              title="Upper Primary"
              subtitle="B4, B5, B6"
              fees={[
                { item: 'Tuition (per term)', amount: '₵ 1,400' },
                { item: 'Books & Materials', amount: '₵ 550' },
                { item: 'Uniform', amount: '₵ 250' },
                { item: 'Activity Fee', amount: '₵ 400' },
                { item: 'Exam Fee (BECE prep)', amount: '₵ 500/year' },
              ]}
              total="₵ 1,400/term"
            />
            <FeeCategoryCard
              title="Junior High School"
              subtitle="JHS 1, JHS 2, JHS 3"
              fees={[
                { item: 'Tuition (per term)', amount: '₵ 1,800' },
                { item: 'Books & Materials', amount: '₵ 700' },
                { item: 'Uniform', amount: '₵ 300' },
                { item: 'Activity Fee', amount: '₵ 500' },
                { item: 'Subject Fees (Sci/Math)', amount: '₵ 400/term' },
                { item: 'Field Trip/Activity', amount: '₵ 300/term' },
              ]}
              total="₵ 1,800/term"
            />
          </div>
        </div>
      </section>

      {/* Payment Methods */}
      <section className="py-12 md:py-16 bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-responsive-h2 font-heading text-primary text-center mb-4">Payment Methods</h2>
          <p className="text-center text-muted-foreground mb-8 max-w-2xl mx-auto">
            We accept multiple payment methods for your convenience.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
            <PaymentMethodCard
              title="MTN Mobile Money"
              description="Pay using MTN MoMo app or USSD *170#"
              icon="smartphone"
            />
            <PaymentMethodCard
              title="Bank Transfer"
              description={`Transfer to our school bank account`}
              icon="bank"
            />
            <PaymentMethodCard
              title="Cash at School"
              description="Pay in cash at our school office during operating hours"
              icon="banknote"
            />
          </div>
        </div>
      </section>

      {/* Fee Calendar */}
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto">
          <h2 className="text-responsive-h2 font-heading text-primary text-center mb-4">Fee Payment Calendar</h2>
          <div className="text-center text-muted-foreground space-y-2">
            <p>Term 1: September – December 2026</p>
            <p>Fees due: First week of September (1st September)</p>
            <p>Late payment penalty: 5% after 10 days</p>
          </div>
          <div className="mt-6 text-center">
            <Button variant="outline">Download Full Fee Schedule (PDF)</Button>
          </div>
        </div>
      </section>
    </div>
  )
}

function FeeCategoryCard({
  title,
  subtitle,
  fees,
  total,
}: {
  title: string
  subtitle: string
  fees: { item: string; amount: string }[]
  total: string
}) {
  return (
    <div className="border border-border rounded-lg p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-2xl font-heading font-semibold text-primary">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground">Total</div>
          <div className="text-xl font-bold text-primary">{total}</div>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2">Item</th>
            <th className="text-right py-2">Amount</th>
          </tr>
        </thead>
        <tbody>
          {fees.map((fee, i) => (
            <tr key={i} className="border-b border-border/30">
              <td className="py-2">{fee.item}</td>
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
  icon: _icon,
}: {
  title: string
  description: string
  icon: string
}) {
  return (
    <div className="text-center p-6 bg-white dark:bg-card rounded-lg shadow-sm border border-border">
      <div className="text-3xl mb-3">★</div>
      <h3 className="font-semibold text-primary mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
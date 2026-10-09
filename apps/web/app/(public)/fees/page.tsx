import { Banknote, Check, Landmark, Smartphone, type LucideIcon } from 'lucide-react'

import { cn } from '@novastar/shared-ui'

import { CARD_PAD, Card, HeroBand, SectionHeading, SectionShell } from '@/components/marketing'
import { getFeeSchedule, type FeeScheduleGroup } from '@/lib/data'
import { generateFeesMetadata } from '@/lib/metadata'

export const metadata = generateFeesMetadata()

/*
 * The rules of payment, from the school's policy document. Paraphrased into a
 * scannable list, because the paragraph they come from is a single run of five
 * sentences and a parent looking for "can I pay this in cash" is not going to
 * find it in the fourth clause.
 *
 * Two sentences are deliberately NOT paraphrased — the bank, and the staff
 * prohibition — because they are the two that cost a parent money and both are
 * below the list, set in terracotta. Everything that is paraphrased here is
 * process; those two are the policy's teeth.
 */
const POLICY_RULES = [
  'Fees are due promptly at the beginning of each session.',
  'If you need a special arrangement, come to the school and discuss it with the administrator or proprietress.',
  'A child whose fees are still unsettled after written notice has been given will not be allowed to stay in school.',
]

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
      {/* Hero. The band wash is `--color-tint-warm` rather than the maroon-tinted
          `from-primary/10` every inner page carried before; `HeroBand` also owns
          the header clearance, which was re-stated per page. */}
      <HeroBand>
        <h1 className="font-serif text-5xl md:text-6xl mx-auto max-w-[18ch] text-center text-primary">Fee Structure</h1>
        <p className="mx-auto mt-6 max-w-[60ch] text-lg leading-relaxed text-foreground/85 text-center">
          Transparent, competitive fees offering excellent value for quality education.
        </p>
      </HeroBand>

      <SectionShell tone="canvas">
        {schedule.length === 0 ? (
          <Card tone="flat" className={cn(CARD_PAD, 'mx-auto max-w-2xl text-center bg-surface-container-low border-transparent')}>
            <h2 className="font-serif text-3xl text-primary">Fee schedule not published yet</h2>
            <p className="mt-4 text-lg text-foreground/85">
              Current fees, due dates and payment terms are shared directly by the
              school office. Call or WhatsApp and we will send this term's schedule.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <a
                href="https://wa.me/233244935251"
                className={cn(
                  'inline-flex items-center justify-center gap-2 rounded-md',
                  'h-11 px-5 text-sm font-medium',
                  'bg-accent-warm text-card-foreground',
                  'hover:bg-accent-warm/90 focus:outline-2 focus:outline-offset-2',
                  'focus:outline-accent-warm',
                )}
              >
                WhatsApp us
              </a>
              <a
                href="tel:+233244935251"
                className={cn(
                  'inline-flex items-center justify-center gap-2 rounded-md',
                  'h-11 px-5 text-sm font-medium',
                  'border border-border bg-transparent',
                  'hover:bg-muted focus:outline-2 focus:outline-offset-2',
                  'focus:outline-border',
                )}
              >
                Call the office
              </a>
            </div>
          </Card>
        ) : (
          <div className="space-y-8">
            {schedule.map((group) => (
              <FeeCategoryCard key={group.levelId} group={group} />
            ))}
          </div>
        )}
      </SectionShell>

      {/*
        Payment policy, from the school's own policy document.

        Placed between the schedule and the methods rather than after them,
        because it qualifies both: it says when fees fall due and it says where
        the money goes, so it belongs after the figure and before the channel.

        The two prohibitions are the reason this is a block and not a paragraph.
        "Paid directly at the bank" and "never to a teacher" are the two ways a
        parent loses money, and both fail quietly — money handed over in cash to
        a member of staff is unrecoverable and unprovable. They are therefore set
        as a labelled list in terracotta (`--color-accent-warm-dark`, 7.11:1 on
        the canvas) rather than in body grey, which is the register this site
        reserves for "pop". No fee amount appears here; see the note at the top
        of this file.
      */}
      <SectionShell tone="canvas">
        <Card tone="flat" className={cn(CARD_PAD, 'mx-auto max-w-3xl bg-surface-container-low border-transparent transition-all duration-700 hover:-translate-y-1 hover:shadow-floating')}>
          <h2 className="font-serif text-2xl text-primary mb-4">Payment Policy</h2>
          <ul className="mt-5 flex flex-col gap-4 text-lg leading-relaxed text-foreground/85">
            {POLICY_RULES.map((rule) => (
              <li key={rule} className="flex gap-3">
                <Check className="mt-1 h-5 w-5 shrink-0 text-primary/40" aria-hidden="true" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 border-t border-border/50 pt-5 text-lg leading-relaxed text-foreground/85">
            <p className="text-secondary-dark font-medium">
              Pay fees directly at the bank. Never pay a teacher or any other
              unauthorised member of staff.
            </p>
            <p className="mt-2.5">
              The school will not take responsibility for any inconvenience that
              arises if this policy is not followed.
            </p>
          </div>
        </Card>
      </SectionShell>

      <SectionShell tone="band">
        {/*
          OUTSTANDING — owner decision, not fixed here.

          These three cards predate the policy document and two of them sit in
          tension with it. "Pay in cash at our school office during operating
          hours" describes handing money to a person at the school, while the
          policy above says fees "are to be paid directly at the bank" and that
          no payment goes to "any teacher or unauthorized staff". Whether a cash
          payment received at the office counts as the school's own account
          depends on a rule the documents do not state, and inventing one here
          would put a made-up payment rule on the page about money — the exact
          failure the empty state above exists to avoid. So the cards are left
          as they are and the tension is reported rather than resolved.
        */}
        <SectionHeading
          align="center"
          title="Payment Methods"
          lede="We accept multiple payment methods for your convenience."
        />
        <div className="mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-6 md:grid-cols-3">
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
      </SectionShell>
    </div>
  )
}

function FeeCategoryCard({ group }: { group: FeeScheduleGroup }) {
  return (
    <Card tone="flat" className={cn(CARD_PAD, 'flex flex-col gap-6 bg-surface-container-low border-transparent transition-all duration-700 hover:-translate-y-1 hover:shadow-floating')}>
      <div>
        <h2 className="font-serif text-2xl text-primary">{group.title}</h2>
        <p className="text-sm text-foreground/70">{group.subtitle}</p>
      </div>
      {/*
        <caption> is not decorative here: a screen reader user landing on one of
        several tables needs to know which programme it belongs to.
      */}
      <table className="w-full text-sm">
        <caption className="sr-only">Fees for {group.title}</caption>
        <thead>
          {/*
            `border-border` is stated, where this used to be a bare `border-b`.
            Tailwind v4 does not load `tailwind.config.mts` (it is dead code —
            see the note at the top of that file), so there is no default border
            colour and a bare `border-b` resolves to `currentColor`: a full-strength
            ink rule under the header row instead of a hairline.
          */}
          <tr className="border-b border-border">
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
    </Card>
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
    <Card tone="flat" className={cn(CARD_PAD, 'flex flex-col items-center text-center bg-surface-container-low border-transparent transition-all duration-700 hover:-translate-y-1 hover:shadow-floating')}>
      <Icon className="mb-4 h-8 w-8 text-primary/40" aria-hidden="true" />
      <h3 className="font-serif text-xl text-primary mb-2">{title}</h3>
      <p className="text-lg leading-relaxed text-foreground/85">{description}</p>
    </Card>
  )
}
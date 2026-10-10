import type { Metadata } from 'next'
import { Landmark, LockKeyhole } from 'lucide-react'

import { cn } from '@novastar/shared-ui'

import {
  CARD_PAD,
  Card,
  Eyebrow,
  HeroBand,
  IconTile,
  SectionHeading,
  SectionShell,
} from '@/components/marketing'
import { MarketingButton, whatsappHref } from '@/components/marketing-button'
import { SCHOOL_INFO, baseMetadata } from '@/lib/metadata'

/*
 * The source is `docs/NOVASTAR POLICIES.docx`, titled "POLICIES FOR PARENTS" — a
 * paper document a parent and the proprietress sign together. It is reproduced
 * here as written. The hard-edged parts are not softened: a child turned away at
 * a locked gate and a fee paid to the wrong person are the two consequences that
 * actually cost a family something, and a policy page that hedges them is worse
 * than no policy page.
 *
 * Two figures were settled after the document was written, and they resolve a
 * conflict between this document and `docs/GENERAL INFORMATION.docx`:
 *
 *   - Collection deadline: 4:00pm. The policies say lessons close at 3pm with a
 *     one-hour grace period; the general information says the school "closes at
 *     4.00 pm". Both are true and both are published — the parent needs the
 *     lesson end AND the moment the child must be gone.
 *   - Late fee: GH₵10.00 per child. The policies defer to "an amount determined
 *     by the school"; the general information names that amount. A figure a
 *     parent can budget from beats a formula they have to ask about.
 *
 * The signature block is deliberately NOT reproduced. A website cannot hold a
 * signature, so a web version of the pledge would be a form nobody signs — see
 * the closing band for what replaces it.
 *
 * Metadata is declared here rather than through a `generatePoliciesMetadata()`
 * factory because `lib/metadata.ts` is owned by another change. The shape is the
 * same one every other inner page uses: spread `baseMetadata` for the title
 * template and Open Graph image, then declare this route's own canonical. A bare
 * `alternates.canonical` inherited from the layout would point every share at
 * the homepage.
 */
export const metadata: Metadata = {
  ...baseMetadata,
  title: 'Policies for Parents',
  description:
    'The policies every parent and guardian at Novastar Montessori School signs for: reporting and collection times, what to send in your child’s bag, meals and naps, health reporting, fees payment, and who may collect your child.',
  /* Trailing slash matches `trailingSlash: true` in next.config.ts. */
  alternates: { canonical: `${SCHOOL_INFO.website}/policies/` },
  openGraph: { ...baseMetadata.openGraph, url: `${SCHOOL_INFO.website}/policies/` },
}

interface Policy {
  /** Position in the signed document, shown so a parent can match it to paper. */
  number: number
  title: string
  /** Verbatim from the document. The last paragraph may be the settled figure. */
  paragraphs: string[]
}

interface PolicyGroup {
  id: string
  title: string
  lede: string
  policies: Policy[]
}

/*
 * Grouped for a parent trying to act, not in document order. Nobody reads a
 * policy list front to back; they read the part that matches the morning they
 * are having. Each group answers one question — when do I drop off, what goes in
 * the bag, what about food and health, what about money, who do I talk to.
 */
const GROUPS: PolicyGroup[] = [
  {
    id: 'school-day',
    title: 'The school day',
    lede: 'When the gates open, when they shut, and what happens to a child who arrives late or leaves late.',
    policies: [
      {
        number: 1,
        title: 'Reporting and closing time',
        paragraphs: [
          'All parents should take note that school starts at 7:00am, hence all children should report to school before lessons are started. School closes 3pm and a 1-hour grace period is given after which a penalty is attracted. Closing time is strictly to be adhered to.',
          'Lessons close at 3:00pm, the one-hour grace period runs to 4:00pm, and all children must be collected by 4:00pm.',
        ],
      },
      {
        number: 2,
        title: 'The gate, and late collection',
        paragraphs: [
          'Parents/guardians should note that the school gate will be locked at 9:00am prompt. Any child who is brought in after the school gates are locked will be asked to go home. Parents/guardians who pick their wards up after 5:00pm, will pay a late fee, an amount determined by the school.',
          'That amount, as the school has determined it, is GH₵10.00 per child.',
        ],
      },
    ],
  },
  {
    id: 'what-to-send',
    title: 'What to send with your child',
    lede: 'What a child wears, what goes in the bag, and whose name is on it. Get these wrong and the day goes wrong before the first lesson.',
    policies: [
      {
        number: 10,
        title: 'School attire and jewellery',
        paragraphs: [
          'Each child is expected to report to school with the appropriate school uniforms on the stipulated days; any child who reports to school without the appropriate uniform, will be asked to go back home. No form of jewellery, including bands are allowed in the school whether for religious or non-religious purposes. Parents are advised to let their female children wear only stud earrings or earrings that would not hang.',
        ],
      },
      {
        number: 3,
        title: 'Nappies, changing and daily supplies',
        paragraphs: [
          'Parents are to put in their ward’s bag a minimum of three (3) diapers and a pack of wipes for children who use diapers, a clean pair of changing underwear or underpants, and two clean face towels. Each child will be changed into the school approved sportswear, and so parents are to make sure that the clean attires are repacked for each day.',
        ],
      },
      {
        number: 4,
        title: 'Labelling your child’s things',
        paragraphs: [
          'Parents/ guardians are to make sure that all their ward’s items are clearly labelled. The school shall not take responsibility for any inconvenience that may arise due to a parent/ guardian’s failure to adhere to this policy.',
        ],
      },
    ],
  },
  {
    id: 'food-rest-health',
    title: 'Food, rest and health',
    lede: 'Meals are compulsory, naps are part of the day, and anything the school does not already know about your child’s health has to be told to them.',
    policies: [
      {
        number: 5,
        title: 'Meals',
        paragraphs: [
          'Meals are compulsory at school. Two meals are served each day, breakfast and lunch. The school should be notified if a child has a health concern relating to any kind of food or meal (Please check medical conditions). The only kind of food allowed from outside the school is a snack.',
        ],
      },
      {
        number: 6,
        title: 'Nap time',
        paragraphs: [
          'Children from a year old and above are given naps each day after their afternoon meals.',
        ],
      },
      {
        number: 7,
        title: 'Medical conditions, medication and check-ups',
        paragraphs: [
          'Any known medical condition, allergies or erratic attacks should be reported to the school with a report from a certified medical officer or paediatrician. Any child who is found out later to have any of such conditions will be asked to withdraw and the school shall not be held responsible for any crisis that shall result from a parent’s failure to notify the school of any of the above conditions.',
          'Any child who is not well should be allowed to stay home and complete his/ her medications before reporting to school again. No medication apart from paracetamol syrup will be allowed in the school. Any form of infection, being it eye or skin or chest, Contagious or not, such as rashes, boils or any likeness is not allowed. Parents are advised to let the child recover completely before reporting to school again. Once a month, the school in conjunction with a certified paediatrician undertakes medical examinations for the children. On such occasions, parents will be informed, if necessary to be present or to consult with the doctors.',
        ],
      },
    ],
  },
  {
    id: 'fees',
    title: 'Fees',
    lede: 'One route for paying, one place to discuss a difficulty, and a hard deadline on both.',
    policies: [
      {
        number: 8,
        title: 'Fees payment',
        paragraphs: [
          'All fees are to be paid promptly at the beginning of each session. If any special arrangements are to be made, the parent/ guardian should come to the school and discuss concerns with the school administrator/proprietress. A child whose fees has still not been settled after a written notice has been given would not be allowed to stay in school. Any form of payable fees is to be paid directly at the bank. No parent/guardian should make payment to any teacher or unauthorized staff. The school will not take responsibility for any inconveniences that may arise if this policy is not adhered to.',
        ],
      },
    ],
  },
  {
    id: 'who-to-speak-to',
    title: 'Who to speak to, and who may collect',
    lede: 'The school administrator and the proprietress receive complaints directly, and they are the only people who can release your child to someone else.',
    policies: [
      {
        number: 9,
        title: 'Collecting your child by a third party',
        paragraphs: [
          'If a parent/ guardian is for any reason, unable to pick up a child, the school should be informed ahead of time and details of the third party should be given to the school. The person will be required to present a certified national ID bearing the person’s name and photograph before the child will be released.',
        ],
      },
      {
        number: 11,
        title: 'Complaints and grievances',
        paragraphs: [
          'Parents/ guardians are to channel all their grievances directly to the school administrator or proprietress. Parents/ guardians are advised not to lodge any complains with teachers or any other staff member.',
        ],
      },
    ],
  },
]

/**
 * The two consequences that cost a family something, promoted above the full
 * text rather than left buried in the fourth and fifth group.
 *
 * The wording restates the policy in plain language instead of quoting it: the
 * verbatim text is in full in its group below, and a page that says the same
 * sentence twice reads as two different rules. Nothing here adds a claim the
 * document does not make — the consequence of each is the consequence the policy
 * already states.
 */
const ALERTS = [
  {
    icon: LockKeyhole,
    title: 'After 9:00am, your child is sent home',
    body: 'The school gate is locked at 9:00am prompt, and any child brought in after the gates are locked will be asked to go home. If you are running late, call the office before you set off.',
  },
  {
    icon: Landmark,
    title: 'Pay at the bank. Never to a teacher.',
    body: 'Any form of payable fees is to be paid directly at the bank. No parent or guardian should make payment to any teacher or unauthorised staff, and the school will not take responsibility for what happens if you do. If a member of staff ever asks you for cash, refuse and tell the office.',
  },
]

export default function PoliciesPage() {
  return (
    <div className="min-h-screen">
      {/* Hero. `HeroBand` owns the band wash, the header clearance and the
          section rhythm, so none of it is re-stated here. */}
      <HeroBand>
        <h1 className="type-display max-w-[18ch]">Policies for Parents</h1>
        <p className="mt-6 max-w-[60ch] text-lg leading-relaxed text-muted-foreground">
          These are the policies every parent and guardian at Novastar signs and is held to,
          written out as they appear on the signed document. Times, what to send, what to
          tell the school about your child&rsquo;s health, how to pay, and who to speak to.
        </p>
      </HeroBand>

      {/* The two hard rules, first. A parent reads this page in a hurry, usually
          about tomorrow morning, and both of these are the kind of thing that is
          only expensive to learn the hard way. */}
      <SectionShell tone="band">
        <SectionHeading
          eyebrow="Read these first"
          title="Two rules worth reading twice"
          lede="Two ordinary rules that catch new families out, and both are much cheaper to know the night before than on the morning."
          layout="centered"
        />
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {ALERTS.map(({ icon: Icon, title, body }) => (
            <Card key={title} className={cn(CARD_PAD, 'flex flex-col gap-5')}>
              <IconTile icon={Icon} />
              <h3 className="type-title-lg text-primary">{title}</h3>
              <p className="type-body-lg leading-relaxed text-foreground">{body}</p>
            </Card>
          ))}
        </div>
      </SectionShell>

      <SectionShell tone="canvas">
        <PolicyGroups groups={[GROUPS[0], GROUPS[1]]} />
      </SectionShell>

      <SectionShell tone="band">
        <PolicyGroups groups={[GROUPS[2]]} />
      </SectionShell>

      <SectionShell tone="canvas">
        <PolicyGroups groups={[GROUPS[3], GROUPS[4]]} />
      </SectionShell>

      {/*
        The pledge, in the school's voice rather than as a signature block.

        The document's pledge is written to be signed — "I……, parent/ guardian to……"
        — and a website cannot hold a signature. Rendering the blank as though it
        were signable would give a parent the impression that a pledge they never
        signed binds them, which is worse than not showing it. So the commitment
        is stated, and the fact that a signed copy exists is stated with it.
      */}
      <SectionShell tone="deep">
        <SectionHeading
          eyebrow="The pledge"
          title="Read them, and keep them somewhere you can find them"
          lede="A parent and the proprietress sign these policies on paper, and a signed copy of that policy statement is held on file for every child."
          layout="centered"
        />
        <div className="mt-10 max-w-[70ch] mx-auto">
          <p className="text-lg leading-relaxed text-foreground text-center">
            The policies that catch people out are the ordinary ones: the time the gate locks,
            the hour the child must be collected by, the bank, and the national ID a third party
            has to carry. None of them are difficult to follow once you know them, and all of
            them are easier to follow than the morning they are discovered.
          </p>
        </div>
        <div className="mt-10 flex flex-wrap gap-3 justify-center">
          <MarketingButton href="/contact">Ask us about a policy</MarketingButton>
          <MarketingButton
            href={whatsappHref(
              SCHOOL_INFO.whatsapp,
              'Hello, I have a question about the school policies for parents.',
            )}
            variant="outline"
            external
          >
            Message us on WhatsApp
          </MarketingButton>
        </div>
      </SectionShell>
    </div>
  )
}

/**
 * One or more groups inside a single `SectionShell`.
 *
 * The column count follows the number of policies rather than being fixed, so a
 * group of three fills its row and a group of one is not a lone card beside an
 * empty cell. The single-card group is capped at `max-w-3xl` instead, which is
 * the measure the other pages use for a full-width text card.
 */
function PolicyGroups({ groups }: { groups: PolicyGroup[] }) {
  return (
    <div className="space-y-14 lg:space-y-16">
      {groups.map((group) => (
        <div key={group.id}>
          <SectionHeading
            title={group.title}
            lede={group.lede}
            layout="centered"
            titleClassName={group.id === 'who-to-speak-to' ? 'max-w-none' : undefined}
          />
          {/*
            A `<ul>` of `<li>`s rather than a `<div>` of `<div>`s: these are a
            list of separate obligations, and the count is announced by assistive
            technology. `Card` renders `as="li"` so the semantic element and the
            visual card are the same box.

            `max-w-3xl` and the responsive column counts go on the `<ul>`, never on
            the `SectionShell` or a wrapper around it: `.container` supplies the
            gutters, so any padding on an ancestor of a `.container` would shift
            its left edge away from the header's and the footer's — the exact
            regression `app/not-found.tsx` documents.
          */}

          {/* Food, rest and health: custom two-column layout with policies 5 & 6 stacked left, policy 7 right */}
          {group.id === 'food-rest-health' ? (
            <div className="mt-10 grid gap-5 md:grid-cols-2">
              <div className="flex flex-col gap-5">
                {group.policies.slice(0, 2).map((policy) => (
                  <PolicyCard key={policy.number} policy={policy} />
                ))}
              </div>
              <div className="flex flex-col gap-5">
                {group.policies.slice(2).map((policy) => (
                  <PolicyCard key={policy.number} policy={policy} />
                ))}
              </div>
            </div>
          ) : (group.id === 'fees' ? (
            <div className="mt-10">
              {group.policies.map((policy) => (
                <PolicyCard key={policy.number} policy={policy} />
              ))}
            </div>
          ) : (
            <ul
              className={cn(
                'mt-10 grid gap-5',
                group.policies.length === 1
                  ? 'max-w-3xl'
                  : group.policies.length === 3
                    ? 'md:grid-cols-2 lg:grid-cols-3'
                    : 'md:grid-cols-2',
              )}
            >
              {group.policies.map((policy) => (
                <PolicyCard key={policy.number} policy={policy} />
              ))}
            </ul>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * One policy, verbatim.
 *
 * The eyebrow carries the number in the signed document rather than a
 * restatement of the title, so a parent holding the paper copy can match the two
 * without reading the whole page.
 */
function PolicyCard({ policy }: { policy: Policy }) {
  return (
    <Card as="li" className={cn(CARD_PAD, 'flex flex-col gap-5')}>
      {/*
        `self-start` because the card is `flex flex-col`: without it the chip's
        auto cross-size stretches to the full card width and reads as a banner
        rather than a label.
      */}
      <Eyebrow className="self-start">Policy {policy.number}</Eyebrow>
      <h3 className="type-title-lg text-primary">{policy.title}</h3>
      {policy.paragraphs.map((paragraph) => (
        <p key={paragraph.slice(0, 32)} className="type-body-lg leading-relaxed text-foreground">
          {paragraph}
        </p>
      ))}
    </Card>
  )
}

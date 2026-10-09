import type { Metadata } from 'next'

import {
  SectionHeading,
  SectionShell,
} from '@/components/marketing'
import { SCHOOL_INFO, baseMetadata } from '@/lib/metadata'

export const metadata: Metadata = {
  ...baseMetadata,
  title: 'Non-Discrimination Policy',
  description:
    'Novastar Montessori School&rsquo;s commitment to equal opportunity and non-discrimination in admissions, employment, and all school activities.',
  alternates: { canonical: `${SCHOOL_INFO.website}/nondiscrimination/` },
  openGraph: { ...baseMetadata.openGraph, url: `${SCHOOL_INFO.website}/nondiscrimination/` },
}

export default function NonDiscriminationPolicyPage() {
  return (
    <div className="min-h-screen">
      <SectionShell tone="deep">
        <SectionHeading
          title="Non-Discrimination Policy"
          lede="Last updated: January 2026. Novastar Montessori School is committed to providing an inclusive environment free from discrimination."
          layout="centered"
        />
      </SectionShell>

      <SectionShell tone="canvas">
        <div className="max-w-4xl mx-auto space-y-12">
          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Policy Statement</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              Novastar Montessori School admits students of any race, colour, national and ethnic origin, religion, sex, gender identity, sexual orientation, disability, or family status to all the rights, privileges, programmes, and activities generally accorded or made available to students at the school. We do not discriminate on the basis of race, colour, national and ethnic origin, religion, sex, gender identity, sexual orientation, disability, age, marital status, or family status in the administration of our educational policies, admissions policies, scholarship and loan programmes, athletic and other school-administered programmes.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Legal Framework</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              This policy is guided by and complies with the following Ghanaian and international instruments:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>The Constitution of the Republic of Ghana, 1992 (Articles 12, 17, 25, 29)</li>
              <li>Children&rsquo;s Act, 1998 (Act 560)</li>
              <li>Persons with Disability Act, 2006 (Act 715)</li>
              <li>Education Act, 2008 (Act 778)</li>
              <li>Labour Act, 2003 (Act 651) — for employment practices</li>
              <li>UN Convention on the Rights of the Child (ratified by Ghana, 1990)</li>
              <li>UN Convention on the Rights of Persons with Disabilities (ratified by Ghana, 2012)</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Protected Characteristics</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              The school prohibits discrimination based on the following protected characteristics:
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
              {[
                'Race and ethnicity',
                'Colour',
                'National origin',
                'Religion or belief',
                'Sex',
                'Gender identity',
                'Sexual orientation',
                'Disability (physical, sensory, intellectual, mental health)',
                'Age',
                'Marital or civil partnership status',
                'Pregnancy and maternity',
                'Family status or caring responsibilities',
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 p-3 bg-surface-container-low rounded-md border border-border/50">
                  <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                  <span className="text-sm text-foreground">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Scope of Application</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              This policy applies to all aspects of school life, including but not limited to:
            </p>
            <ul className="mt-4 space-y-3 list-disc pl-6 text-foreground/85">
              <li><strong>Admissions:</strong> Enrolment decisions, waiting lists, sibling priority, and intake criteria</li>
              <li><strong>Curriculum and instruction:</strong> Class placement, subject access, assessment methods, and academic support</li>
              <li><strong>Co-curricular activities:</strong> Sports, arts, clubs, trips, and leadership opportunities</li>
              <li><strong>Student support:</strong> Counselling, learning support, health services, and pastoral care</li>
              <li><strong>Discipline:</strong> Behaviour management, sanctions, and exclusion procedures</li>
              <li><strong>Employment:</strong> Recruitment, promotion, training, pay, and working conditions for all staff</li>
              <li><strong>Governance:</strong> Board appointments, committee membership, and parent representation</li>
              <li><strong>Facilities and services:</strong> Accessibility of buildings, transport, meals, and communications</li>
              <li><strong>Procurement and partnerships:</strong> Contractor selection and community engagement</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Reasonable Accommodations</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              The school is committed to making reasonable accommodations for students, staff, and visitors with disabilities. This includes:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>Physical modifications to buildings and grounds (ramps, handrails, accessible toilets)</li>
              <li>Assistive technology and alternative format materials (large print, audio, Braille)</li>
              <li>Flexible scheduling, additional time, or alternative assessment methods</li>
              <li>Communication support (sign language interpreters, simplified language, visual aids)</li>
              <li>Individualised learning plans developed with parents and specialists</li>
            </ul>
            <p className="mt-4 text-foreground/85">
              Requests for accommodations should be made to the Head of School or the School Administrator. We will engage in an interactive process to identify appropriate accommodations without imposing undue hardship on the school.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Harassment and Bullying</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              Harassment based on any protected characteristic is a form of discrimination and is strictly prohibited. This includes:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>Verbal abuse, slurs, epithets, or derogatory comments</li>
              <li>Physical threats, intimidation, or assault</li>
              <li>Cyberbullying via school or personal devices</li>
              <li>Exclusion, rumour-spreading, or social manipulation</li>
              <li>Display or circulation of offensive materials</li>
            </ul>
            <p className="mt-4 text-foreground/85">
              All reports of harassment will be investigated promptly and fairly. Disciplinary action will be taken where warranted, up to and including exclusion or dismissal. Retaliation against anyone who reports harassment or participates in an investigation is prohibited.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Reporting Discrimination</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              Any student, parent, staff member, or visitor who experiences or witnesses discrimination or harassment should report it immediately:
            </p>
            <div className="mt-4 space-y-3 text-foreground/85">
              <p><strong>Students and parents:</strong> Speak to your class teacher, the School Administrator, or the Head of School.</p>
              <p><strong>Staff:</strong> Report to your line manager, the School Administrator, or the Head of School. You may also use the staff grievance procedure.</p>
              <p><strong>Visitors and others:</strong> Contact the School Administrator or Head of School directly.</p>
              <p><strong>Email:</strong> <a href={`mailto:${SCHOOL_INFO.email}`} className="underline hover:text-primary">{SCHOOL_INFO.email}</a> (mark &ldquo;Confidential — Discrimination Report&rdquo;)</p>
              <p><strong>Phone:</strong> <a href={`tel:${SCHOOL_INFO.phoneHref}`} className="underline hover:text-primary">{SCHOOL_INFO.phone}</a></p>
            </div>
            <p className="mt-4 text-foreground/85">
              All reports will be treated confidentially to the extent possible while allowing a thorough investigation. The school will not tolerate retaliation against any person who makes a good-faith report.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Investigation and Resolution</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              Upon receiving a report, the school will:
            </p>
            <ol className="mt-4 space-y-2 list-decimal pl-6 text-foreground/85">
              <li>Acknowledge receipt within 2 business days</li>
              <li>Conduct a fair, impartial, and timely investigation</li>
              <li>Interview relevant parties and review evidence</li>
              <li>Apply the preponderance-of-evidence standard</li>
              <li>Communicate the outcome to the complainant and respondent</li>
              <li>Implement corrective and preventive measures</li>
              <li>Maintain records in accordance with data protection requirements</li>
            </ol>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Training and Awareness</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              The school provides regular training to ensure the community understands this policy:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>Annual anti-discrimination and harassment training for all staff</li>
              <li>Inclusion and diversity workshops for teaching staff</li>
              <li>Age-appropriate lessons for students on respect, empathy, and equality</li>
              <li>Information for parents at orientation and in the parent handbook</li>
              <li>Induction for new staff, governors, and volunteers</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Monitoring and Review</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              The school monitors the effectiveness of this policy through:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>Analysis of admissions, attainment, exclusion, and staffing data by protected characteristic</li>
              <li>Annual climate surveys for students, parents, and staff</li>
              <li>Review of complaints and incidents</li>
              <li>External benchmarking and audit</li>
              <li>Reporting to the Board of Governors at least annually</li>
            </ul>
            <p className="mt-4 text-foreground/85">
              This policy will be reviewed at least every two years, or sooner if legislation changes or significant issues arise.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Contact</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              For questions about this policy or to report a concern:
            </p>
            <div className="mt-4 space-y-2 text-foreground/85">
              <p>Novastar Montessori School</p>
              <p>Email: <a href={`mailto:${SCHOOL_INFO.email}`} className="underline hover:text-primary">{SCHOOL_INFO.email}</a></p>
              <p>Phone: <a href={`tel:${SCHOOL_INFO.phoneHref}`} className="underline hover:text-primary">{SCHOOL_INFO.phone}</a></p>
              <p>Address: {SCHOOL_INFO.location}</p>
            </div>
          </div>
        </div>
      </SectionShell>

      <SectionShell tone="band">
        <SectionHeading
          layout="centered"
          title="Everyone belongs at Novastar"
          lede="We are committed to a school community where every child and every adult feels valued, respected, and safe."
        />
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <a
            href={`mailto:${SCHOOL_INFO.email}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-sm px-4 font-medium text-sm transition-colors duration-fast bg-primary text-white hover:bg-primary/90"
          >
            Contact Us
          </a>
          <a
            href="/about"
            className="inline-flex min-h-11 items-center gap-2 rounded-sm px-4 font-medium text-sm transition-colors duration-fast border border-primary text-primary hover:bg-primary/5"
          >
            About Our School
          </a>
        </div>
      </SectionShell>
    </div>
  )
}
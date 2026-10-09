import type { Metadata } from 'next'

import { cn } from '@novastar/shared-ui'
import {
  Card,
  CARD_PAD,
  SectionHeading,
  SectionShell,
} from '@/components/marketing'
import { SCHOOL_INFO, baseMetadata } from '@/lib/metadata'

export const metadata: Metadata = {
  ...baseMetadata,
  title: 'Privacy Policy',
  description:
    'How Novastar Montessori School collects, uses, stores, and protects your personal information. We are transparent about our data practices and your rights.',
  alternates: { canonical: `${SCHOOL_INFO.website}/privacy/` },
  openGraph: { ...baseMetadata.openGraph, url: `${SCHOOL_INFO.website}/privacy/` },
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen">
      <SectionShell tone="deep">
        <SectionHeading
          title="Privacy Policy"
          lede="Last updated: January 2026. We respect your privacy and are committed to protecting your personal data."
          layout="centered"
        />
      </SectionShell>

      <SectionShell tone="canvas">
        <div className="max-w-4xl mx-auto space-y-12">
          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">1. Information We Collect</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              We collect personal information that you provide directly to us when you interact with our school, including:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>Contact details: name, email address, phone number, postal address</li>
              <li>Child information: name, date of birth, medical information, dietary requirements, emergency contacts</li>
              <li>Academic records: assessments, reports, attendance records</li>
              <li>Payment information: billing details, transaction history (processed securely via our payment partners)</li>
              <li>Communication records: emails, WhatsApp messages, enquiry forms, meeting notes</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">2. How We Use Your Information</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              We use your personal information for the following purposes:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>To provide educational services and care for your child</li>
              <li>To communicate with you about your child&rsquo;s progress, school events, and administrative matters</li>
              <li>To process fees and manage financial records</li>
              <li>To comply with legal obligations (Ghana Education Service, NaCCA, data protection laws)</li>
              <li>To improve our services and website experience</li>
              <li>To ensure the health, safety, and welfare of all children in our care</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">3. Legal Basis for Processing</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              Under Ghana&rsquo;s Data Protection Act, 2012 (Act 843) and international standards, we process your data on the following lawful bases:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>Contractual necessity: to fulfil our agreement to educate and care for your child</li>
              <li>Legal obligation: to meet regulatory requirements from GES, NaCCA, and other authorities</li>
              <li>Legitimate interest: to operate our school effectively, communicate with parents, and improve services</li>
              <li>Consent: for marketing communications (newsletter, event invitations) where you have opted in</li>
              <li>Vital interests: to protect the health and safety of children in emergencies</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">4. Data Sharing and Disclosure</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              We do not sell your personal information. We share data only in these circumstances:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>With your explicit consent</li>
              <li>With authorised staff who need it to perform their duties (teachers, administrators, support staff)</li>
              <li>With regulatory bodies (Ghana Education Service, NaCCA, social services) where legally required</li>
              <li>With payment processors for secure fee transactions</li>
              <li>With IT service providers who host and maintain our systems (under strict data processing agreements)</li>
              <li>In response to a valid legal request, court order, or to protect vital interests</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">5. Data Retention</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              We retain personal information only as long as necessary for the purposes outlined above, and in compliance with Ghanaian education and tax record-keeping requirements. Typical retention periods:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>Enrolment and academic records: 7 years after the child leaves the school</li>
              <li>Financial records: 7 years for tax and audit purposes</li>
              <li>Medical and health information: until the child reaches age 21, or 7 years after leaving, whichever is longer</li>
              <li>Communication records: 3 years after last contact</li>
              <li>Website analytics data: 26 months (anonymised)</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">6. Your Rights</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              You have the following rights regarding your personal data:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li><strong>Access:</strong> Request a copy of the personal data we hold about you or your child</li>
              <li><strong>Rectification:</strong> Ask us to correct inaccurate or incomplete data</li>
              <li><strong>Erasure:</strong> Request deletion of data where there is no compelling reason for us to continue processing it</li>
              <li><strong>Restriction:</strong> Ask us to restrict processing in certain circumstances</li>
              <li><strong>Portability:</strong> Receive your data in a structured, commonly used format</li>
              <li><strong>Object:</strong> Object to processing based on legitimate interests, including direct marketing</li>
              <li><strong>Withdraw consent:</strong> Withdraw consent for marketing communications at any time</li>
            </ul>
            <p className="mt-4 text-foreground/85">
              To exercise any of these rights, please contact us at <a href={`mailto:${SCHOOL_INFO.email}`} className="underline hover:text-primary">{SCHOOL_INFO.email}</a> or call <a href={`tel:${SCHOOL_INFO.phoneHref}`} className="underline hover:text-primary">{SCHOOL_INFO.phone}</a>.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">7. Data Security</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              We implement appropriate technical and organisational measures to protect personal data against unauthorised access, loss, destruction, or alteration. These include:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>Secure, encrypted connections (HTTPS) for all website interactions</li>
              <li>Role-based access controls for staff systems</li>
              <li>Regular security assessments and staff training</li>
              <li>Secure disposal of physical records</li>
              <li>Data processing agreements with all third-party processors</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">8. Cookies and Website Analytics</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              Our website uses essential cookies for functionality and optional analytics cookies (with your consent) to understand how visitors use our site. You can manage cookie preferences via the cookie banner or your browser settings. We use privacy-respecting analytics that do not track individuals across sites.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">9. Children&rsquo;s Data</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              We take extra care with children&rsquo;s personal data. We only collect what is necessary for their education and welfare, and we never use children&rsquo;s data for marketing or profiling. Parents and guardians exercise data protection rights on behalf of their children.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">10. International Transfers</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              We do not routinely transfer personal data outside Ghana. If a transfer is necessary (e.g., cloud hosting), we ensure adequate safeguards such as standard contractual clauses or the recipient&rsquo;s participation in a recognised adequacy framework.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">11. Changes to This Policy</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              We may update this Privacy Policy from time to time. The latest version will always be posted on this page with the &ldquo;Last updated&rdquo; date. Material changes will be communicated directly to parents via email or the parent portal.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">12. Contact Us</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              If you have questions about this Privacy Policy or our data practices, please contact our Data Protection Officer:
            </p>
            <div className="mt-4 space-y-2 text-foreground/85">
              <p>Novastar Montessori School</p>
              <p>Email: <a href={`mailto:${SCHOOL_INFO.email}`} className="underline hover:text-primary">{SCHOOL_INFO.email}</a></p>
              <p>Phone: <a href={`tel:${SCHOOL_INFO.phoneHref}`} className="underline hover:text-primary">{SCHOOL_INFO.phone}</a></p>
              <p>Address: {SCHOOL_INFO.address}</p>
            </div>
          </div>
        </div>
      </SectionShell>

      <SectionShell tone="band">
        <SectionHeading
          layout="centered"
          title="Questions about your data?"
          lede="We&rsquo;re happy to explain how we handle your information or help you exercise your rights."
        />
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <a
            href={`mailto:${SCHOOL_INFO.email}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-sm px-4 font-medium text-sm transition-colors duration-fast bg-primary text-white hover:bg-primary/90"
          >
            Email Us
          </a>
          <a
            href="/contact"
            className="inline-flex min-h-11 items-center gap-2 rounded-sm px-4 font-medium text-sm transition-colors duration-fast border border-primary text-primary hover:bg-primary/5"
          >
            Contact Page
          </a>
        </div>
      </SectionShell>
    </div>
  )
}
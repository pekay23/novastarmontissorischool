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
  title: 'Terms of Use',
  description:
    'Terms and conditions governing the use of the Novastar Montessori School website and services. Please read these terms carefully before using our website.',
  alternates: { canonical: `${SCHOOL_INFO.website}/terms/` },
  openGraph: { ...baseMetadata.openGraph, url: `${SCHOOL_INFO.website}/terms/` },
}

export default function TermsOfUsePage() {
  return (
    <div className="min-h-screen">
      <SectionShell tone="deep">
        <SectionHeading
          title="Terms of Use"
          lede="Last updated: January 2026. By accessing and using this website, you accept and agree to be bound by these Terms of Use."
          layout="centered"
        />
      </SectionShell>

      <SectionShell tone="canvas">
        <div className="max-w-4xl mx-auto space-y-12">
          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">1. Acceptance of Terms</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              By accessing, browsing, or using the Novastar Montessori School website (<code>novastarmontessori.edu.gh</code> or any subdomain), you acknowledge that you have read, understood, and agree to be bound by these Terms of Use and our Privacy Policy. If you do not agree with any part of these terms, please do not use our website.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">2. Description of Services</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              This website provides information about Novastar Montessori School, including our curriculum, admissions process, fees, calendar, news, and contact details. It also provides access to the Parent Portal for enrolled families. The website is an informational and communication tool; it does not constitute an offer of enrolment or a contract for educational services.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">3. Use of the Website</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              You agree to use this website only for lawful purposes and in a manner consistent with its intended function as a school information and communication platform. You must not:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>Use the website in any way that violates applicable laws or regulations</li>
              <li>Attempt to gain unauthorised access to any part of the website, server, or database</li>
              <li>Interfere with the proper working of the website (e.g., scraping, automated queries, denial-of-service)</li>
              <li>Transmit viruses, malware, or any harmful code</li>
              <li>Use the website to harass, abuse, or threaten any individual</li>
              <li>Reproduce, distribute, or create derivative works from our content without permission</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">4. Intellectual Property</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              All content on this website &mdash; including text, images, graphics, logos, videos, documents, and code &mdash; is the property of Novastar Montessori School or its licensors and is protected by Ghanaian and international copyright laws. You may not reproduce, distribute, modify, or create derivative works without our prior written consent, except for:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>Personal, non-commercial viewing and printing</li>
              <li>Sharing links to our pages (not framing or embedding content)</li>
              <li>Downloading forms and documents explicitly provided for parent use</li>
            </ul>
            <p className="mt-4 text-foreground/85">
              The name &ldquo;Novastar Montessori School&rdquo;, our logo, and associated marks are trademarks of the school. Unauthorised use is prohibited.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">5. Parent Portal Access</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              The Parent Portal is a secure area for enrolled families only. Access is granted per family and is subject to the following:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>Credentials are personal and must not be shared</li>
              <li>You are responsible for all activity under your account</li>
              <li>Notify us immediately if you suspect unauthorised access</li>
              <li>Access may be suspended or revoked if terms are violated or enrolment ends</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">6. Admissions and Enrolment</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              Information about admissions on this website is for guidance only. Submission of an enquiry or application form does not guarantee a place. Formal enrolment requires a signed enrolment agreement, payment of applicable fees, and completion of all required documentation. The school reserves the right to refuse admission or withdraw an offer in accordance with its admissions policy.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">7. Fees and Payments</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              Fee information on this website is indicative and subject to change. The definitive fee schedule is provided in the enrolment agreement and fee letters. All fees must be paid directly to the school&rsquo;s designated bank account. The school accepts no liability for payments made to unauthorised individuals or accounts.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">8. Disclaimer of Warranties</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              This website is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, either express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, or non-infringement. While we strive to keep information accurate and up to date, we do not warrant that:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>The website will be uninterrupted, timely, secure, or error-free</li>
              <li>The information is complete, accurate, or current at all times</li>
              <li>Defects will be corrected immediately</li>
              <li>The website or its servers are free of viruses or harmful components</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">9. Limitation of Liability</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              To the maximum extent permitted by law, Novastar Montessori School shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, data, use, or goodwill arising out of or in connection with your use of or inability to use this website. Our total liability for any claim arising from these terms shall not exceed the fees paid by you to the school in the twelve months preceding the claim, or GH₵1,000, whichever is less.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">10. Indemnification</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              You agree to indemnify, defend, and hold harmless Novastar Montessori School, its directors, staff, and agents from and against any claims, damages, losses, and expenses (including reasonable legal fees) arising out of your use of the website, violation of these terms, or violation of any rights of a third party.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">11. Links to Third-Party Sites</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              Our website may contain links to third-party websites (e.g., payment portals, social media, external resources). These links are provided for convenience only. We do not control, endorse, or assume responsibility for the content, privacy practices, or security of any third-party sites. Your use of third-party sites is at your own risk.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">12. Governing Law and Jurisdiction</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              These Terms of Use are governed by and construed in accordance with the laws of the Republic of Ghana. Any dispute arising out of or in connection with these terms shall be subject to the exclusive jurisdiction of the courts of Ghana.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">13. Changes to These Terms</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              We may modify these Terms of Use at any time. Changes take effect immediately upon posting to this page with an updated &ldquo;Last updated&rdquo; date. Your continued use of the website after changes constitutes acceptance of the new terms. We encourage you to review these terms periodically.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">14. Severability</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              If any provision of these Terms of Use is found to be unenforceable or invalid, that provision will be limited or eliminated to the minimum extent necessary so that the remaining provisions remain in full force and effect.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">15. Contact Us</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              If you have questions about these Terms of Use, please contact us:
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
          title="Need clarification?"
          lede="We&rsquo;re here to help you understand our terms."
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
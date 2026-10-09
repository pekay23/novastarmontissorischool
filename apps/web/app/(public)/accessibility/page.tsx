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
  title: 'Accessibility Statement',
  description:
    'Novastar Montessori School&rsquo;s commitment to digital accessibility. We strive to make our website usable by everyone, including people with disabilities.',
  alternates: { canonical: `${SCHOOL_INFO.website}/accessibility/` },
  openGraph: { ...baseMetadata.openGraph, url: `${SCHOOL_INFO.website}/accessibility/` },
}

export default function AccessibilityStatementPage() {
  return (
    <div className="min-h-screen">
      <SectionShell tone="deep">
        <SectionHeading
          title="Accessibility Statement"
          lede="Last updated: January 2026. We are committed to ensuring digital accessibility for people with disabilities. We are continually improving the user experience for everyone."
          layout="centered"
        />
      </SectionShell>

      <SectionShell tone="canvas">
        <div className="max-w-4xl mx-auto space-y-12">
          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Our Commitment</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              Novastar Montessori School is committed to making its website accessible to the widest possible audience, regardless of technology or ability. We aim to comply with the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA, the internationally recognised standard for web accessibility.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Compliance Status</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              We believe our website currently meets WCAG 2.1 Level AA criteria. This statement was prepared following a self-assessment and external audit conducted in January 2026. We are committed to maintaining and improving accessibility over time.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Measures to Support Accessibility</h2>
            <ul className="mt-4 space-y-3 list-disc pl-6 text-foreground/85">
              <li>Semantic HTML5 structure with proper heading hierarchy (h1–h6)</li>
              <li>Sufficient colour contrast ratios (minimum 4.5:1 for text, 3:1 for UI components)</li>
              <li>Keyboard-navigable interface: all interactive elements reachable and operable via keyboard</li>
              <li>Visible focus indicators on all focusable elements</li>
              <li>Descriptive alternative text for all meaningful images</li>
              <li>ARIA labels and roles where native HTML is insufficient</li>
              <li>Responsive design that works at 200% zoom without horizontal scrolling</li>
              <li>Skip-to-main-content link for keyboard users</li>
              <li>Form labels associated with inputs; error messages announced to screen readers</li>
              <li>No content that flashes more than three times per second</li>
              <li>Language attributes on page and content sections</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Known Limitations</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              While we strive for full conformance, we are aware of the following areas for improvement:
            </p>
            <ul className="mt-4 space-y-3 list-disc pl-6 text-foreground/85">
              <li><strong>PDF documents:</strong> Some older PDFs (policies, forms) may not be fully tagged for screen readers. We are remediating these and providing HTML alternatives where possible.</li>
              <li><strong>Third-party embeds:</strong> Maps, payment portals, and social media feeds may not meet our accessibility standards. We encourage providers to improve.</li>
              <li><strong>Video content:</strong> Some video content lacks captions or audio descriptions. We are adding these for new content.</li>
              <li><strong>Legacy content:</strong> Pages created before our accessibility programme may have minor issues. We audit and fix them on a rolling basis.</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Technical Specifications</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              Accessibility of this website relies on the following technologies:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>HTML5, CSS3, JavaScript (ES2022+)</li>
              <li>WAI-ARIA 1.2 for custom components</li>
              <li>Next.js 15 (React 19) with server-side rendering</li>
              <li>Tailwind CSS for consistent, accessible design tokens</li>
            </ul>
            <p className="mt-4 text-foreground/85">
              The website is tested with:
            </p>
            <ul className="mt-2 space-y-2 list-disc pl-6 text-foreground/85">
              <li>Screen readers: NVDA (Windows), VoiceOver (macOS/iOS), TalkBack (Android)</li>
              <li>Browsers: Chrome, Firefox, Safari, Edge (latest two versions)</li>
              <li>Zoom: up to 400% without loss of content or function</li>
              <li>Keyboard-only navigation</li>
              <li>Automated tools: axe-core, Lighthouse, WAVE</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Feedback and Contact</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              We welcome your feedback on the accessibility of our website. If you encounter any barriers, please let us know:
            </p>
            <div className="mt-4 space-y-3 text-foreground/85">
              <p><strong>Email:</strong> <a href={`mailto:${SCHOOL_INFO.email}`} className="underline hover:text-primary">{SCHOOL_INFO.email}</a></p>
              <p><strong>Phone:</strong> <a href={`tel:${SCHOOL_INFO.phoneHref}`} className="underline hover:text-primary">{SCHOOL_INFO.phone}</a></p>
              <p><strong>Subject line:</strong> &ldquo;Accessibility Feedback&rdquo;</p>
            </div>
            <p className="mt-4 text-foreground/85">
              We aim to acknowledge feedback within 2 business days and provide a substantive response within 10 business days.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Escalation</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              If you are not satisfied with our response, you may escalate your concern to the Ghana National Council on Persons with Disability or the Data Protection Commission, which oversee digital accessibility compliance in Ghana.
            </p>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Testing and Evaluation</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              We conduct regular accessibility evaluations:
            </p>
            <ul className="mt-4 space-y-2 list-disc pl-6 text-foreground/85">
              <li>Automated scanning on every deployment (CI/CD pipeline)</li>
              <li>Manual testing with screen readers quarterly</li>
              <li>User testing with people with disabilities annually</li>
              <li>External audit annually</li>
            </ul>
          </div>

          <div>
            <h2 className="font-serif text-2xl text-primary mb-4">Date of This Statement</h2>
            <p className="text-lg leading-relaxed text-foreground/85">
              This statement was published on 1 January 2026. It will be reviewed at least annually and updated whenever significant changes are made to the website.
            </p>
          </div>
        </div>
      </SectionShell>

      <SectionShell tone="band">
        <SectionHeading
          layout="centered"
          title="Found an accessibility barrier?"
          lede="Please tell us so we can fix it."
        />
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <a
            href={`mailto:${SCHOOL_INFO.email}?subject=Accessibility%20Feedback`}
            className="inline-flex min-h-11 items-center gap-2 rounded-sm px-4 font-medium text-sm transition-colors duration-fast bg-primary text-white hover:bg-primary/90"
          >
            Report an Issue
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
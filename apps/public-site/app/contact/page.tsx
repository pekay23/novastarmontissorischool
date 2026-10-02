import { Button } from '@novastar/shared-ui'
import { Clock, Mail, MapPin, MessageCircle, Phone } from 'lucide-react'
import { SCHOOL_INFO, generateContactMetadata } from '@/lib/metadata'

export const metadata = generateContactMetadata()

/*
 * There is no server to receive a contact form: `output: 'export'` builds a
 * static bundle and `app/api/` cannot run. The previous version rendered a
 * "Send Message" form with no action and no handler, so every submission
 * silently vanished. Contact routes are surfaced as tel:, mailto: and WhatsApp
 * links instead, which work on a static host.
 */
export default function ContactPage() {
  const whatsappHref = `https://wa.me/${SCHOOL_INFO.whatsapp}?text=${encodeURIComponent(
    `Hello ${SCHOOL_INFO.name}, I would like to enquire about admissions.`,
  )}`

  return (
    <div className="min-h-screen">
      <section className="bg-gradient-to-b from-primary/10 to-transparent py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-responsive-h1 font-heading text-primary mb-4">Contact Us</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            We&apos;d love to hear from you. Call, message, or visit our campus in Kumasi.
          </p>
        </div>
      </section>

      <section className="section-y">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
            <div>
              <h2 className="text-responsive-h2 font-heading text-primary mb-8">
                How to reach us
              </h2>

              <ul className="space-y-8">
                <li className="flex items-start gap-4">
                  <MapPin className="w-6 h-6 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold text-primary mb-1">Address</h3>
                    <p className="text-foreground/80">{SCHOOL_INFO.location}</p>
                  </div>
                </li>

                <li className="flex items-start gap-4">
                  <Phone className="w-6 h-6 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold text-primary mb-1">Phone</h3>
                    <a
                      href={`tel:${SCHOOL_INFO.phoneHref}`}
                      className="text-foreground/80 underline decoration-border underline-offset-4 hover:text-primary"
                    >
                      {SCHOOL_INFO.phone}
                    </a>
                  </div>
                </li>

                <li className="flex items-start gap-4">
                  <Mail className="w-6 h-6 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold text-primary mb-1">Email</h3>
                    <a
                      href={`mailto:${SCHOOL_INFO.email}`}
                      className="text-foreground/80 underline decoration-border underline-offset-4 hover:text-primary"
                    >
                      {SCHOOL_INFO.email}
                    </a>
                  </div>
                </li>

                <li className="flex items-start gap-4">
                  <Clock className="w-6 h-6 shrink-0 text-primary" aria-hidden="true" />
                  <div>
                    <h3 className="font-semibold text-primary mb-1">Office Hours</h3>
                    <dl className="text-foreground/80">
                      {SCHOOL_INFO.hours.map((entry) => (
                        <div key={entry.days} className="flex gap-2">
                          <dt>{entry.days}</dt>
                          <dd>{entry.time}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </li>
              </ul>

              {/* Keyless Google Maps embed — `output=embed` needs no API key. */}
              <iframe
                src={SCHOOL_INFO.mapEmbedUrl}
                title={`Map showing ${SCHOOL_INFO.name} in Kumasi`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="mt-8 aspect-video w-full rounded-lg border border-border"
              />
              <p className="mt-3 text-sm">
                <a
                  href={SCHOOL_INFO.mapLinkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-4"
                >
                  Get directions on Google Maps
                </a>
              </p>
            </div>

            <div className="rounded-xl border border-border bg-surface p-8">
              <h2 className="text-responsive-h3 font-heading text-primary mb-3">
                Talk to the admissions office
              </h2>
              <p className="text-muted-foreground mb-6">
                WhatsApp is the quickest way to reach us during office hours. If you
                would rather apply straight away, the online form takes about five
                minutes.
              </p>

              <div className="space-y-3">
                <Button className="w-full" size="lg" asChild>
                  <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="h-4 w-4" aria-hidden="true" />
                    Message us on WhatsApp
                  </a>
                </Button>
                <Button variant="outline" className="w-full" size="lg" asChild>
                  <a href={`tel:${SCHOOL_INFO.phoneHref}`}>
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    Call {SCHOOL_INFO.phone}
                  </a>
                </Button>
                <Button variant="outline" className="w-full" size="lg" asChild>
                  <a href={`mailto:${SCHOOL_INFO.email}`}>
                    <Mail className="h-4 w-4" aria-hidden="true" />
                    Email the school
                  </a>
                </Button>
                <Button variant="ghost" className="w-full" size="lg" asChild>
                  <a href="/admissions">Apply online instead</a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
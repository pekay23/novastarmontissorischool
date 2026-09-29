import { SCHOOL_INFO } from '@/lib/metadata'
import { Button } from '@novastar/shared-ui'
import { Phone, Mail, MapPin, Clock } from 'lucide-react'
import { metadata } from '@/lib/metadata'

export { metadata }

export default function ContactPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="bg-gradient-to-b from-primary/10 to-transparent py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-responsive-h1 font-heading text-primary mb-4">Contact Us</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            We'd love to hear from you. Send us a message or visit us at our campus.
          </p>
        </div>
      </section>

      {/* Contact Info + Form */}
      <section className="py-12 md:py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            {/* Contact Info */}
            <div className="space-y-8">
              <div className="flex items-start gap-4">
                <MapPin className="w-6 h-6 text-primary mt-1 shrink-0" />
                <div>
                  <h3 className="font-semibold text-primary mb-1">Address</h3>
                  <p className="text-foreground/80">{SCHOOL_INFO.location}</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <Phone className="w-6 h-6 text-primary mt-1 shrink-0" />
                <div>
                  <h3 className="font-semibold text-primary mb-1">Phone</h3>
                  <p className="text-foreground/80">{SCHOOL_INFO.phone}</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <Mail className="w-6 h-6 text-primary mt-1 shrink-0" />
                <div>
                  <h3 className="font-semibold text-primary mb-1">Email</h3>
                  <p className="text-foreground/80">{SCHOOL_INFO.email}</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <Clock className="w-6 h-6 text-primary mt-1 shrink-0" />
                <div>
                  <h3 className="font-semibold text-primary mb-1">Office Hours</h3>
                  <p className="text-foreground/80">Monday – Friday: 7:30 AM – 5:30 PM</p>
                  <p className="text-foreground/80">Saturday: 9:00 AM – 1:00 PM</p>
                  <p className="text-foreground/80">Sunday: Closed</p>
                </div>
              </div>

              {/* Map */}
              <div className="aspect-video bg-gray-200 dark:bg-gray-700 rounded-lg mt-6">
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  Interactive map will be embedded here
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div>
              <form className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input label="First Name" required />
                  <Input label="Last Name" required />
                </div>
                <Input label="Email" type="email" required />
                <Input label="Phone" />
                <Input label="Subject" required />
                <Textarea label="Message" required rows={6} />
                <Button type="submit" className="w-full">Send Message</Button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function Input({ label, type, required }: { label: string; type?: string; required?: boolean }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}{required && '*'}</label>
      <input
        type={type || 'text'}
        required={required}
        className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  )
}

function Textarea({ label, required, rows }: { label: string; required?: boolean; rows?: number }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}{required && '*'}</label>
      <textarea
        required={required}
        rows={rows || 4}
        className="w-full px-3 py-2 border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  )
}
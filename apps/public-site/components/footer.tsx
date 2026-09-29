import { Button } from '@novastar/shared-ui'


interface FooterProps {
  school: {
    name: string
    address: string
    phone: string
    email: string
    hours: string
  }
}

export function Footer({ school }: FooterProps) {
  const currentYear = new Date().getFullYear()

  return (
    <footer className="bg-slate-900 text-slate-100 py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* School Info */}
          <div>
            <h3 className="font-heading text-xl font-bold text-white mb-4">
              {school.name}
            </h3>
            <p className="text-slate-300 text-sm mb-4">{school.address}</p>
            <div className="text-slate-300 text-sm">
              <p>📞 {school.phone}</p>
              <p>📧 {school.email}</p>
              <p>🕒 {school.hours}</p>
            </div>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="font-semibold text-white mb-4">Quick Links</h4>
            <ul className="space-y-2 text-sm">
              <FooterLink href="/about">About Us</FooterLink>
              <FooterLink href="/academics">Academic Programs</FooterLink>
              <FooterLink href="/admissions">Admissions</FooterLink>
              <FooterLink href="/fees">Fee Structure</FooterLink>
              <FooterLink href="/contact">Contact Us</FooterLink>
            </ul>
          </div>

          {/* Programs */}
          <div>
            <h4 className="font-semibold text-white mb-4">Programs</h4>
            <ul className="space-y-2 text-sm">
              <FooterLink href="/academics/creche">Creche & Nursery</FooterLink>
              <FooterLink href="/academics/kindergarten">Kindergarten</FooterLink>
              <FooterLink href="/academics/lower-primary">Lower Primary</FooterLink>
              <FooterLink href="/academics/upper-primary">Upper Primary</FooterLink>
              <FooterLink href="/academics/jhs">Junior High School</FooterLink>
            </ul>
          </div>

          {/* Newsletter */}
          <div>
            <h4 className="font-semibold text-white mb-4">Stay Updated</h4>
            <p className="text-slate-300 text-sm mb-3">
              Subscribe for news and updates
            </p>
            <form className="space-y-2">
              <input
                type="email"
                placeholder="Enter your email"
                className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <Button size="sm" className="w-full">Subscribe</Button>
            </form>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-6 text-center text-sm text-slate-400">
          <p>&copy; {currentYear} {school.name}. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <a
        href={href}
        className="text-slate-300 hover:text-white transition-colors"
      >
        {children}
      </a>
    </li>
  )
}
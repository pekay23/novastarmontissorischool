
import { getBranding, getHomeStats, getHeroContent, getFeatures, getTestimonials, getCTAContent, getAcademicPrograms } from '@/lib/data'
import { Button } from '@novastar/shared-ui'
import { ProgramCard } from '@/components/program-card'
import { metadata } from '@/lib/metadata'

export { metadata }

export default async function HomePage() {
  const [branding, stats, hero, features, testimonials, cta, programs] = await Promise.all([
    getBranding(),
    getHomeStats(),
    getHeroContent(),
    getFeatures(),
    getTestimonials(),
    getCTAContent(),
    getAcademicPrograms(),
  ])

  const schoolName = branding?.name || 'Novastar Montessori School'
  const heroTitle = hero?.title || schoolName
  const heroSubtitle = hero?.subtitle || 'Authentic Montessori Education from Creche to Junior High in Kumasi, Ghana'
  const heroCta = hero?.cta || 'Apply Now'
  const heroSecondaryCta = hero?.secondaryCta || 'Learn More'
  const ctaTitle = cta?.title || 'Ready to Join Our Community?'
  const ctaSubtitle = cta?.subtitle || 'Give your child the foundation for a lifetime of learning through authentic Montessori education'
  const ctaButton = cta?.cta || 'Apply Now'

  return (
    <>
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center text-center px-4">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-accent/20" />
        <div className="relative z-10 max-w-4xl mx-auto">
          <h1 className="text-responsive-h1 font-heading text-primary mb-6">
            {heroTitle}
          </h1>
          <p className="text-xl md:text-2xl text-foreground/80 mb-8 max-w-2xl mx-auto">
            {heroSubtitle}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button size="lg" className="text-lg px-8">
              {heroCta}
            </Button>
            <Button size="lg" variant="outline" className="text-lg px-8">
              {heroSecondaryCta}
            </Button>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 md:py-16 bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {stats.map((stat, i) => (
              <StatCard key={i} label={stat.label} value={stat.value} />
            ))}
          </div>
        </div>
      </section>

      {/* Programs */}
      <section className="py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-responsive-h2 font-heading text-primary mb-4">
              Our Academic Programs
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              From Creche to Junior High School, we offer authentic Montessori
              education integrated with Ghana Education Service standards.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            {programs.map((program) => (
              <ProgramCard key={program.id} program={program} />
            ))}
          </div>
        </div>
      </section>

      {/* Key Features */}
      <section className="py-16 md:py-20 bg-muted/30">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-responsive-h2 font-heading text-primary mb-4">
              Why Choose Novastar?
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              We combine Montessori philosophy with Ghanaian curriculum standards
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {features.map((feature, i) => (
              <FeatureCard key={i} title={feature.title} desc={feature.desc} icon={feature.icon} />
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-16 md:py-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-responsive-h2 font-heading text-primary mb-4">
              What Parents Say
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {testimonials.map((testimonial, i) => (
              <TestimonialCard key={i} name={testimonial.name} relation={testimonial.relation} quote={testimonial.quote} />
            ))}
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-16 md:py-20 bg-gradient-to-r from-primary to-secondary text-white">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-responsive-h2 font-heading mb-4">
            {ctaTitle}
          </h2>
          <p className="text-lg mb-8 max-w-2xl mx-auto">
            {ctaSubtitle}
          </p>
          <Button size="lg" variant="secondary" className="text-lg px-8">
            {ctaButton}
          </Button>
        </div>
      </section>
    </>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white dark:bg-card rounded-lg p-6 shadow-sm border border-border">
      <div className="text-3xl md:text-4xl font-bold text-primary mb-1">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  )
}

function FeatureCard({ title, desc, icon: _icon }: { title: string; desc: string; icon: string }) {
  return (
    <div className="bg-white dark:bg-card rounded-lg p-6 shadow-sm border border-border text-center">
      <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-4">
        <div className="text-primary">★</div>
      </div>
      <h3 className="text-xl font-semibold text-primary mb-2">{title}</h3>
      <p className="text-muted-foreground">{desc}</p>
    </div>
  )
}

function TestimonialCard({ 
  name, 
  relation, 
  quote 
}: { 
  name: string
  relation: string
  quote: string
}) {
  return (
    <div className="bg-white dark:bg-card rounded-lg p-6 shadow-sm border border-border">
      <div className="mb-4">
        {'★'.repeat(5).split('').map((star, i) => (
          <span key={i} className="text-yellow-400">
            {star}
          </span>
        ))}
      </div>
      <p className="text-foreground/80 mb-4">"{quote}"</p>
      <div className="font-semibold text-primary">{name}</div>
      <div className="text-sm text-muted-foreground">{relation}</div>
    </div>
  )
}
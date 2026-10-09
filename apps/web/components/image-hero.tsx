import { cn } from '@novastar/shared-ui'
import { ReactNode } from 'react'

interface ImageHeroProps {
  eyebrow: string
  title: ReactNode
  subtitle: string
  imageSrc: string
  imageAlt: string
  actions?: ReactNode
  children?: ReactNode
  className?: string
  /* Whether the image should have a darker overlay to make text more readable */
  overlayDarkness?: 'light' | 'medium' | 'dark'
}

/**
 * A full-width image hero, used on the Preschool page (and similar pages).
 * This replaces the parallax hero with a more immediate, photographic, magazine-style header.
 */
export function ImageHero({
  eyebrow,
  title,
  subtitle,
  imageSrc,
  imageAlt,
  actions,
  children,
  className,
  overlayDarkness = 'medium',
}: ImageHeroProps) {
  const overlayMap = {
    light: 'bg-black/20',
    medium: 'bg-gradient-to-t from-black/80 via-black/40 to-black/10',
    dark: 'bg-black/60',
  }

  return (
    <section className={cn('relative isolate overflow-hidden', className)}>
      {/* Background Image */}
      <div className="absolute inset-0 -z-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt={imageAlt}
          className="h-full w-full object-cover object-center"
          // We load the hero image eagerly because it's LCP
          loading="eager"
          // next/image would add layout thrashing if we don't know the exact dimensions, 
          // and a standard img tag with object-cover is usually sufficient for these hero backgrounds
        />
        {/* Overlay for text legibility */}
        <div className={cn('absolute inset-0', overlayMap[overlayDarkness])} />
      </div>

      <div className="container relative z-10 flex min-h-[60vh] flex-col justify-end pb-16 pt-32 lg:pb-24 lg:pt-48">
        <div className="flex flex-col gap-6 lg:max-w-[70%]">
          {/* We use a custom solid eyebrow here that is white/transparent for contrast against the dark overlay */}
          <span className="inline-flex w-fit items-center rounded-xs bg-white/20 px-2.5 py-1 uppercase type-eyebrow text-white backdrop-blur-sm">
            {eyebrow}
          </span>
          
          <h1 className="type-display font-serif text-white max-w-[16ch] leading-[1.1]">{title}</h1>
          
          <p className="max-w-[58ch] text-lg leading-relaxed text-white/90 font-medium">
            {subtitle}
          </p>
          
          {actions && (
            <div className="flex flex-wrap items-center gap-3 pt-4">
              {actions}
            </div>
          )}
        </div>
        
        {children && <div className="mt-12 w-full">{children}</div>}
      </div>
    </section>
  )
}

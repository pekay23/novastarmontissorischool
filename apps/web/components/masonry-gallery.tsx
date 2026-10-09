'use client'

import { cn } from '@novastar/shared-ui'

interface ImageInfo {
  src: string
  alt: string
  aspect?: 'square' | 'video' | 'portrait' | 'wide'
}

interface MasonryGalleryProps {
  images: ImageInfo[]
  className?: string
}

export function MasonryGallery({ images, className }: MasonryGalleryProps) {
return (
      <div className={cn("grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6", className)}>
        {images.map((image, i) => {
          let aspectClass = 'aspect-square'
          if (image.aspect === 'video') aspectClass = 'aspect-video col-span-2'
          if (image.aspect === 'portrait') aspectClass = 'aspect-[3/4] row-span-2'
          if (image.aspect === 'wide') aspectClass = 'aspect-[21/9] col-span-2'

          return (
            <div 
              key={i} 
              className={cn(
                "group relative overflow-hidden rounded-xl bg-surface-container-highest shadow-hairline hover:shadow-floating transition-all duration-500 animate-reveal-up opacity-0",
                aspectClass
              )}
              style={{ animationDelay: `${0.1 + i * 0.15}s`, animationFillMode: 'forwards' }}
            >
            <div className="absolute inset-0 bg-primary/20 opacity-0 group-hover:opacity-100 mix-blend-overlay transition-opacity duration-500 z-10 pointer-events-none" />
            <img
              src={image.src}
              alt={image.alt}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
              loading="lazy"
            />
          </div>
        )
      })}
    </div>
  )
}

import { cn } from '@novastar/shared-ui'
import { Play } from 'lucide-react'

interface PhotoMosaicProps {
  primaryImage: string
  primaryAlt: string
  secondaryImage: string
  secondaryAlt: string
  tertiaryImage: string
  tertiaryAlt: string
  className?: string
}

/**
 * A 3-image mosaic used to showcase classrooms visually.
 * The primary image can act as a video placeholder (shows a play button).
 */
export function PhotoMosaic({
  primaryImage,
  primaryAlt,
  secondaryImage,
  secondaryAlt,
  tertiaryImage,
  tertiaryAlt,
  className
}: PhotoMosaicProps) {
  return (
    <div className={cn("grid grid-cols-1 md:grid-cols-12 gap-4 md:h-[500px]", className)}>
      {/* Small image left */}
      <div className="hidden md:block md:col-span-3 h-full overflow-hidden rounded-sm shadow-floating relative group">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={secondaryImage} alt={secondaryAlt} className="h-full w-full object-cover transition-transform duration-[2s] group-hover:scale-105" loading="lazy" />
        <div className="absolute inset-0 border border-black/10 rounded-sm"></div>
      </div>
      
      {/* Large central image (video placeholder) */}
      <div className="relative col-span-1 md:col-span-6 h-[300px] md:h-full overflow-hidden rounded-sm shadow-floating group cursor-pointer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={primaryImage} alt={primaryAlt} className="h-full w-full object-cover transition-transform duration-[2s] group-hover:scale-105" loading="lazy" />
        <div className="absolute inset-0 border border-black/10 rounded-sm z-10 pointer-events-none"></div>
        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/30 transition-colors duration-700 flex items-center justify-center z-20">
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-white/90 shadow-floating text-primary transition-transform duration-500 group-hover:scale-110">
            <Play className="h-6 w-6 ml-1" aria-hidden="true" fill="currentColor" />
          </div>
        </div>
        <div className="absolute bottom-6 left-6 right-6 text-center z-30">
          <span className="inline-block rounded-sm bg-black/60 px-4 py-2 text-[10px] font-bold tracking-[0.2em] uppercase text-white backdrop-blur-md">
            Video tour coming soon
          </span>
        </div>
      </div>
      
      {/* Small image right */}
      <div className="hidden md:block md:col-span-3 h-full overflow-hidden rounded-sm shadow-floating relative group">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={tertiaryImage} alt={tertiaryAlt} className="h-full w-full object-cover transition-transform duration-[2s] group-hover:scale-105" loading="lazy" />
        <div className="absolute inset-0 border border-black/10 rounded-sm"></div>
      </div>
    </div>
  )
}

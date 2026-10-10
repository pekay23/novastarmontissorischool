import './globals.css'
import type { Metadata } from 'next'
import { Inter, Poppins } from 'next/font/google'
import { Providers } from '@/app/providers'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-heading',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Novastar Montessori School Portal',
  description: 'School Management Portal for Novastar Montessori School, Kumasi, Ghana',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${poppins.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

import { isLoopbackHttp } from './transport'

/** Per-request policy for dynamically rendered authenticated sections. */
export function sectionContentSecurityPolicy(section: '/portal' | '/admin', nonce: string, requestUrl?: Pick<URL, 'protocol' | 'hostname'>): string {
  const localHttp = isLoopbackHttp(requestUrl)
  const portal = section === '/portal'
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${portal ? ' https://js.stripe.com https://uploadthing.com https://www.google.com https://www.gstatic.com https://va.vercel-scripts.com' : ''}`,
    `style-src 'self' 'unsafe-inline'${portal ? ' https://fonts.googleapis.com' : ''}`,
    `img-src 'self' blob: data:${portal ? ' https://utfs.io https://*.ufs.sh https://uploadthing.com https://lh3.googleusercontent.com' : ''}`,
    "font-src 'self' https: data:",
    portal
      ? "connect-src 'self' https://api.stripe.com https://*.supabase.co wss://*.supabase.co https://*.uploadthing.com https://*.ufs.sh https://vitals.vercel-insights.com"
      : "connect-src 'self'",
    portal
      ? "frame-src 'self' blob: https://js.stripe.com https://hooks.stripe.com https://www.google.com/recaptcha/"
      : "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(localHttp ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
}

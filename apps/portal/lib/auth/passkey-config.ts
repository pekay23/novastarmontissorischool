/**
 * WebAuthn Relying Party (RP) configuration for passkey authentication.
 *
 * IMPORTANT: rpID is permanently bound to stored credentials.
 * Changing the domain after passkeys are registered will invalidate them all.
 *
 * Adapted from Aerojet Academy's `lib/auth/passkey-config.ts`.
 */

const isDev = process.env.NODE_ENV === 'development'

// In dev, rpID must match the hostname in the browser URL bar.
const devRpID = process.env.NEXT_PUBLIC_DOMAIN || 'localhost'

const prodDomain = process.env.NEXT_PUBLIC_DOMAIN || 'novastarmontissorischool.com'

export const rpConfig = {
  rpName: 'Novastar Montessori School',
  rpID: isDev ? devRpID : prodDomain,
  origin: isDev
    ? [`http://${devRpID}:3000`, 'http://localhost:3000']
    : [`https://${prodDomain}`, `https://www.${prodDomain}`],
} as const

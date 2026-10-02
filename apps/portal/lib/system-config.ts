import 'server-only'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

/**
 * Feature flag definitions with defaults and validation.
 * Used by both the config API and the platform settings pages.
 */
export const FEATURE_FLAGS: Record<string, {
  description: string
  category: string
  defaultValue: unknown
  schema: z.ZodType
}> = {
  ai_enabled: {
    description: 'Enable AI-powered report cards and data query',
    category: 'academics',
    defaultValue: false,
    schema: z.boolean(),
  },
  sms_enabled: {
    description: 'Enable SMS notifications (requires MTN MoMo key)',
    category: 'communications',
    defaultValue: false,
    schema: z.boolean(),
  },
  offline_mode: {
    description: 'Enable offline-first (IndexedDB sync)',
    category: 'infrastructure',
    defaultValue: true,
    schema: z.boolean(),
  },
  sso_google: {
    description: 'Enable Google SSO login',
    category: 'auth',
    defaultValue: false,
    schema: z.boolean(),
  },
  sso_microsoft: {
    description: 'Enable Microsoft Entra ID SSO login',
    category: 'auth',
    defaultValue: false,
    schema: z.boolean(),
  },
  sso_saml: {
    description: 'Enable SAML SSO login',
    category: 'auth',
    defaultValue: false,
    schema: z.boolean(),
  },
}

/** Ensure all feature flags exist in the DB for a tenant with defaults. */
export async function ensureFeatureFlags(tenantId: string) {
  const writeData = Object.entries(FEATURE_FLAGS).map(([key, def]) => ({
    key,
    tenantId,
    value: def.defaultValue as Prisma.InputJsonValue,
    description: def.description,
    category: def.category,
  }))
  await prisma.$transaction(
    writeData.map((data) =>
      prisma.systemConfig.upsert({
        where: { tenantId_key: { tenantId, key: data.key } },
        update: {},
        create: data,
      })
    )
  )
}

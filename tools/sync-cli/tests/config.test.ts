import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_DRAIN_ITERATIONS,
  flagNumber,
  flagString,
  parseFlags,
  redact,
  requireEnv,
  requireRemoteConfig,
  requireStrategy,
  requireTenantIdFlag,
  resolveConfig,
  resolveDatabaseUrl,
  resolveTenantId,
  scopeToSchool,
} from '../config'
import { DEFAULT_SYNC_CONFIG } from '@novastar/sync-engine'
import { TEST_ENV, runCli, SPAWN_TIMEOUT_MS } from './helpers'

describe('parseFlags', () => {
  test('reads values, --key=value and boolean flags', () => {
    const { flags, positional } = parseFlags([
      'status',
      '--tenant',
      'school-a',
      '--json',
      '--strategy=merge',
      '--limit',
      '20',
    ])
    expect(positional).toEqual(['status'])
    expect(flags.tenant).toBe('school-a')
    expect(flags.json).toBe(true)
    expect(flags.strategy).toBe('merge')
    expect(flags.limit).toBe('20')
  })

  test('rejects a value flag with nothing after it', () => {
    expect(() => parseFlags(['status', '--tenant'])).toThrow(/--tenant needs a value/)
  })

  test('treats a missing value as absent rather than as the next flag', () => {
    expect(() => parseFlags(['status', '--tenant', '--json'])).toThrow(/--tenant needs a value/)
  })

  test('flag accessors narrow types and validate numbers', () => {
    const { flags } = parseFlags(['--limit', 'abc'])
    expect(flagString(flags, 'limit')).toBe('abc')
    expect(() => flagNumber(flags, 'limit')).toThrow(/must be an integer/)
    expect(flagNumber({ limit: '7' }, 'limit')).toBe(7)
    expect(flagNumber({}, 'limit', 3)).toBe(3)
  })
})

describe('environment', () => {
  test('a missing DATABASE_URL names the variable', () => {
    expect(() => resolveDatabaseUrl({})).toThrow(/DATABASE_URL/)
    expect(() => resolveConfig({}, {})).toThrow(/DATABASE_URL/)
  })

  test('DIRECT_URL is the documented fallback', () => {
    expect(resolveDatabaseUrl({ DIRECT_URL: 'postgres://direct/db' })).toBe('postgres://direct/db')
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgres://pool/db', DIRECT_URL: 'postgres://direct/db' })).toBe(
      'postgres://pool/db',
    )
  })

  test('an empty value counts as missing', () => {
    expect(() => resolveDatabaseUrl({ DATABASE_URL: '   ' })).toThrow(/DATABASE_URL/)
  })

  test('requireEnv names what is missing', () => {
    expect(() => requireEnv('SYNC_API_TOKEN', {})).toThrow(/SYNC_API_TOKEN is not set/)
    expect(requireEnv('SYNC_API_TOKEN', { SYNC_API_TOKEN: 't' })).toBe('t')
  })

  test('requireRemoteConfig needs both the url and the token', () => {
    expect(() => requireRemoteConfig({})).toThrow(/SYNC_API_URL/)
    expect(() => requireRemoteConfig({ SYNC_API_URL: 'https://x' })).toThrow(/SYNC_API_TOKEN/)
    expect(requireRemoteConfig({ SYNC_API_URL: 'https://x', SYNC_API_TOKEN: 't' })).toEqual({
      apiUrl: 'https://x',
      apiToken: 't',
    })
  })

  test('redact hides credentials and leaves a bare url readable', () => {
    expect(redact('postgres://user:secret@host:5432/db')).toBe('postgres://***@host:5432/db')
    expect(redact('postgres://host/db')).toBe('postgres://host/db')
  })

  test('the resolved config never carries a raw connection string into output', () => {
    const config = resolveConfig({ tenant: TEST_ENV.TENANT_ID! }, { ...TEST_ENV })
    expect(config.databaseUrl).toContain('sync:sync')
    expect(config.databaseUrlRedacted).toBe('postgres://***@127.0.0.1:5432/sync_test')
  })
})

describe('tenant resolution', () => {
  test('the flag wins over TENANT_ID', () => {
    expect(resolveTenantId({ tenant: 'from-flag' }, { TENANT_ID: 'from-env' })).toBe('from-flag')
    expect(resolveTenantId({}, { TENANT_ID: 'from-env' })).toBe('from-env')
  })

  test('no tenant anywhere is an error, never a default', () => {
    expect(() => resolveTenantId({}, {})).toThrow(/tenantId is required/)
    expect(() => requireTenantIdFlag(undefined, '--tenant')).toThrow(/--tenant is required/)
  })

  test('rejects a tenant id that cannot be one', () => {
    expect(() => requireTenantIdFlag('school one', '--tenant')).toThrow(/not a valid tenant id/)
    expect(() => requireTenantIdFlag("'; drop table students; --", '--tenant')).toThrow(/not a valid tenant id/)
    expect(requireTenantIdFlag('school-1', '--tenant')).toBe('school-1')
  })
})

describe('conflict strategy', () => {
  test('is never defaulted', () => {
    expect(() => requireStrategy({}, { TENANT_ID: 't' })).toThrow(/--strategy/)
    expect(requireStrategy({ strategy: 'merge' }, {})).toBe('merge')
    expect(requireStrategy({}, { SYNC_CONFLICT_STRATEGY: 'ask-user' })).toBe('ask-user')
  })

  test('rejects a value outside the union from the engine', () => {
    expect(() => requireStrategy({ strategy: 'whatever-wins' }, {})).toThrow(/Unknown strategy/)
  })

  test('read-only commands do not need one', () => {
    expect(resolveConfig({ tenant: 't' }, TEST_ENV).strategy).toBeUndefined()
  })
})

describe('config defaults', () => {
  test('batch size and retries come from the engine, not from a copy', () => {
    const config = resolveConfig({ tenant: 't' }, TEST_ENV)
    expect(config.batchSize).toBe(DEFAULT_SYNC_CONFIG.batchSize)
    expect(config.retryAttempts).toBe(DEFAULT_SYNC_CONFIG.retryAttempts)
    expect(config.retryDelayMs).toBe(DEFAULT_SYNC_CONFIG.retryDelayMs)
    expect(config.maxIterations).toBe(DEFAULT_DRAIN_ITERATIONS)
    expect(config.maxIterations).toBe(10)
  })

  test('flags override the defaults', () => {
    const config = resolveConfig({ tenant: 't', 'max-iterations': '3', 'batch-size': '10' }, TEST_ENV)
    expect(config.maxIterations).toBe(3)
    expect(config.batchSize).toBe(10)
  })
})

describe('school scoping', () => {
  test('keeps records with no school and records for that school', () => {
    const records = [
      { data: { schoolId: 'a' } },
      { data: { schoolId: 'b' } },
      { data: {} },
    ]
    expect(scopeToSchool(records, 'a')).toEqual([{ data: { schoolId: 'a' } }, { data: {} }])
    expect(scopeToSchool(records, undefined)).toHaveLength(3)
  })
})

describe('the built CLI', () => {
  test('--help exits 0 with no database and no token', async () => {
    const result = await runCli(['--help'], {
      DATABASE_URL: '',
      DIRECT_URL: '',
      SYNC_API_URL: '',
      SYNC_API_TOKEN: '',
      TENANT_ID: '',
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('novastar-sync')
    expect(result.stdout).toContain('DESTROYS UNSYNCED WORK')
  }, SPAWN_TIMEOUT_MS)

  test('no arguments at all prints help and exits 0', async () => {
    const result = await runCli([], { DATABASE_URL: '', DIRECT_URL: '' })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage:')
  }, SPAWN_TIMEOUT_MS)

  test('a missing DATABASE_URL exits non-zero and names the variable', async () => {
    const result = await runCli(['status', '--json'], {
      DATABASE_URL: '',
      DIRECT_URL: '',
      TENANT_ID: 'school-a',
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('DATABASE_URL')
  }, SPAWN_TIMEOUT_MS)

  test('an unknown command exits non-zero', async () => {
    const result = await runCli(['frobnicate'], { DATABASE_URL: '' })
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Unknown command')
  }, SPAWN_TIMEOUT_MS)
})
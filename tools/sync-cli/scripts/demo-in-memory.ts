/**
 * Proves the engine is not a stub, without a database and without a browser.
 *
 * Constructs `SyncEngine` over the in-memory `SyncStorage`, writes three records
 * for one tenant plus one for another, and prints what `getPendingChanges()`
 * returns. Before the storage was injectable this was a function that returned
 * `[]` no matter what had been written.
 *
 *   bun run scripts/demo-in-memory.ts
 */
import { MemorySyncStorage, SyncEngine } from '@novastar/sync-engine'

const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'

async function main(): Promise<void> {
  const storage = new MemorySyncStorage()
  const engine = new SyncEngine(undefined, storage)

  await engine.write('students', { id: 's1', tenantId: TENANT_A, firstName: 'Adwoa' })
  await engine.write('students', { id: 's2', tenantId: TENANT_A, firstName: 'Kwame' })
  await engine.write('staff', { id: 't1', tenantId: TENANT_A, firstName: 'Ama' })
  await engine.write('students', { id: 'x1', tenantId: TENANT_B, firstName: 'Someone Else' })

  const pending = await engine.getPendingChanges(TENANT_A)
  console.log(`records written      : 4 (3 for ${TENANT_A}, 1 for ${TENANT_B})`)
  console.log(`getPendingChanges(${TENANT_A}).length : ${pending.length}`)
  for (const record of pending) {
    console.log(
      `  ${record.table}/${record.recordId}  ${record.operation}  ` +
        `${record.syncStatus}  ${record.timestamp.toISOString()}`,
    )
  }
  console.log(`pending for ${TENANT_B}    : ${(await engine.getPendingChanges(TENANT_B)).length}`)

  console.log('\nrefuses a missing tenantId:')
  for (const [label, call] of [
    ['getPendingChanges()', () => engine.getPendingChanges(undefined as unknown as string)],
    ['clear("")', () => engine.clear('')],
  ] as const) {
    try {
      await call()
      console.log(`  ${label}: NO ERROR — that is a bug`)
    } catch (error) {
      console.log(`  ${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

await main()
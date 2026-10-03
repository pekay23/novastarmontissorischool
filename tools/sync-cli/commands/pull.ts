import { runDirection } from './sync'
import type { CommandContext } from '../config'

/** `pull` — remote changes only, nothing queued is sent. */
export function run(ctx: CommandContext): Promise<number> {
  return runDirection(ctx, 'pull')
}
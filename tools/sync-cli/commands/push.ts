import { runDirection } from './sync'
import type { CommandContext } from '../config'

/** `push` — pending records only, no pull. */
export function run(ctx: CommandContext): Promise<number> {
  return runDirection(ctx, 'push')
}
/**
 * Confirmation that cannot hang.
 *
 * Three ways this resolves, in order, and never a fourth:
 *
 *   1. `--yes` was passed: proceed, and say that is why.
 *   2. There is no TTY: decline, and say that too. CI has no TTY, so an
 *      unanswerable prompt is a refusal, not a wait. A deploy step that blocks
 *      on a terminal nobody is watching is a stuck pipeline, and a stuck
 *      pipeline is worse than a deploy that did not run.
 *   3. There is a TTY: ask once, read one line, close. No retry loop, and a
 *      timeout in case a human walks away from the terminal.
 */
import { createInterface } from "node:readline";

/** Long enough to type a migration name, short enough not to strand a job. */
export const CONFIRM_TIMEOUT_MS = 120_000;

export interface ConfirmOptions {
  readonly yes: boolean;
  /** Overridable for tests. Defaults to this process's stdin. */
  readonly input?: NodeJS.ReadStream;
  readonly output?: NodeJS.WriteStream;
  readonly timeoutMs?: number;
  /** Only these answers accept. Default: `y` / `yes`. */
  readonly accept?: readonly string[];
}

export function hasTty(stream: { isTTY?: boolean } = process.stdin): boolean {
  return stream.isTTY === true;
}

export async function confirm(
  question: string,
  options: ConfirmOptions,
): Promise<boolean> {
  if (options.yes) {
    console.log(`[migrate] ${question} -> yes (--yes, no prompt)`);
    return true;
  }

  const input = options.input ?? process.stdin;
  if (!hasTty(input)) {
    console.error(
      `[migrate] ${question} -> NO. There is no TTY to confirm on, and --yes ` +
        "was not passed. Refusing rather than waiting for input that will " +
        "never come.",
    );
    return false;
  }

  const output = options.output ?? process.stdout;
  const accept = options.accept ?? ["y", "yes"];
  const timeoutMs = options.timeoutMs ?? CONFIRM_TIMEOUT_MS;

  return new Promise<boolean>((resolvePromise) => {
    const rl = createInterface({ input, output, terminal: true });
    let answered = false;

    const finish = (value: boolean, why: string): void => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      rl.close();
      console.log(`[migrate] ${question} -> ${value ? "yes" : "no"} (${why})`);
      resolvePromise(value);
    };

    const timer = setTimeout(
      () => finish(false, "timed out with no answer"),
      timeoutMs,
    );

    // stdin closed without a line: decline rather than hang.
    rl.on("close", () => finish(false, "input closed without an answer"));
    rl.question(`${question} [y/N] `, (answer) => {
      finish(accept.includes(answer.trim().toLowerCase()), "answered at the terminal");
    });
  });
}

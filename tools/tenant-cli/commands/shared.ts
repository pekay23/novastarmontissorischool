/**
 * Argument parsing and confirmation helpers shared by the command modules.
 *
 * Kept apart from `index.ts` so a command can be imported without pulling in the
 * dispatcher, and apart from `validate.ts` so parsing stays a separate concern
 * from schema validation.
 */
import { optionalEnv } from "../config";
import { ValidationError } from "../validate";

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * The parsed form of `argv.slice(2)`.
 *
 * Supports `--flag`, `--key value` and `--key=value`. Everything that does not
 * start with `--` is a positional argument. `--` ends flag parsing.
 */
export class ArgMap {
  /** Positional arguments, in order. */
  readonly positionals: readonly string[];
  private readonly values: Map<string, string | true>;

  constructor(positionals: string[], values: Map<string, string | true>) {
    this.positionals = positionals;
    this.values = values;
  }

  static parse(argv: readonly string[]): ArgMap {
    const positionals: string[] = [];
    const values = new Map<string, string | true>();
    let flagsEnded = false;

    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index];

      if (flagsEnded || !token.startsWith("--")) {
        positionals.push(token);
        continue;
      }

      if (token === "--") {
        flagsEnded = true;
        continue;
      }

      const body = token.slice(2);
      const equals = body.indexOf("=");
      if (equals !== -1) {
        const name = body.slice(0, equals);
        if (name.length === 0) throw new UsageError(`Malformed argument "${token}".`);
        values.set(name, body.slice(equals + 1));
        continue;
      }

      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        values.set(body, next);
        index += 1;
      } else {
        values.set(body, true);
      }
    }

    return new ArgMap(positionals, values);
  }

  at(index: number): string | undefined {
    return this.positionals[index];
  }

  /** True when the flag is present, whether or not it was given a value. */
  flag(name: string): boolean {
    return this.values.get(name) !== undefined;
  }

  /** The flag's value, or `undefined` when absent or supplied without one. */
  get(name: string): string | undefined {
    const value = this.values.get(name);
    return value === undefined || value === true ? undefined : value;
  }

  /** A required option value, with a message naming the flag. */
  require(name: string): string {
    const value = this.get(name);
    if (value === undefined || value.length === 0) {
      throw new ValidationError([{ path: `--${name}`, message: "Required." }]);
    }
    return value;
  }

  boolean(name: string): boolean {
    const value = this.values.get(name);
    if (value === undefined) return false;
    if (value === true) return true;
    if (value === "false" || value === "no" || value === "0") return false;
    if (value === "true" || value === "yes" || value === "1") return true;
    throw new ValidationError([{ path: `--${name}`, message: `Expected a boolean, received "${value}".` }]);
  }
}

/**
 * Resolves a tenant code from `--<name>`, falling back to `TENANT_CODE`.
 *
 * The fallback is what makes `show`, `config *` and `suspend` usable against the
 * one tenant an operator is usually working on, without typing its code.
 */
export function resolveTenantCode(args: ArgMap, name = "tenant"): string {
  const explicit = args.get(name);
  if (explicit !== undefined && explicit.length > 0) return explicit;

  const fallback = optionalEnv("TENANT_CODE");
  if (fallback !== undefined) return fallback;

  throw new ValidationError([
    { path: `--${name}`, message: `Required. No ${name} code was given and TENANT_CODE is not set.` },
  ]);
}

/**
 * Gates a mutating operation.
 *
 * On a terminal the operator types the described action to confirm. With no
 * terminal there is nobody to ask, so `--yes` is required. There is no default:
 * an unattended process must state its intent explicitly.
 */
export async function requireConfirmation(args: ArgMap, description: string): Promise<void> {
  if (args.boolean("yes")) return;

  if (!process.stdin.isTTY) {
    throw new UsageError(
      `Refusing to ${description} without confirmation: stdin is not a terminal. Pass --yes to proceed.`,
    );
  }

  const answer = (await readLine(`Type "${description}" to continue: `, false)).trim();
  if (answer !== description) {
    throw new UsageError(`Aborted: the confirmation text did not match "${description}".`);
  }
}

/**
 * Reads a secret from the environment, or from a masked prompt on a terminal.
 *
 * There is no default and no command-line option: a value on `argv` is visible
 * to every process on the machine and ends up in shell history. When neither
 * source is available the error names the variable to set.
 */
export async function readSecret(envVar: string, prompt: string): Promise<string> {
  const fromEnv = optionalEnv(envVar);
  if (fromEnv !== undefined) return fromEnv;

  if (!process.stdin.isTTY) {
    throw new ValidationError([
      { path: envVar, message: `Required and not set. Export ${envVar}, or run from a terminal to be prompted.` },
    ]);
  }

  const value = await readLine(prompt, true);
  if (value.length === 0) {
    throw new ValidationError([{ path: envVar, message: "Required and not set." }]);
  }
  return value;
}

/**
 * Reads one line from stdin. With `mask` the typed characters are not echoed.
 *
 * Implemented on the raw stream rather than through `node:readline`, which has no
 * masked-input mode: without this the administrator password would be printed as
 * it was typed.
 */
function readLine(prompt: string, mask: boolean): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const input = process.stdin;
    const wasRaw = input.isRaw === true;
    input.setRawMode?.(true);
    input.resume();
    process.stderr.write(prompt);

    let buffer = "";
    const cleanup = (): void => {
      input.removeListener("data", onData);
      input.setRawMode?.(wasRaw);
      input.pause();
      process.stderr.write("\n");
    };

    function onData(chunk: Buffer): void {
      const text = chunk.toString("utf8");

      if (text === "\r" || text === "\n" || text === "\u0004") {
        cleanup();
        resolve(buffer);
        return;
      }

      if (text === "\u0003") {
        cleanup();
        reject(new UsageError("Aborted."));
        return;
      }

      // Backspace.
      if (text === "\u007f") {
        buffer = buffer.slice(0, -1);
        if (!mask) process.stderr.write("\b \b");
        return;
      }

      buffer += text;
      if (!mask) process.stderr.write(text);
    }

    input.on("data", onData);
  });
}
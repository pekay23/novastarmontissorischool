#!/usr/bin/env bun
/**
 * `novastar-tenant` -- tenant provisioning, cloning and configuration.
 *
 * `--help` works with no database, no environment and no arguments. That is a
 * hard requirement, not a convenience: an operator who cannot read the usage
 * text cannot recover from mistyping it, and the dispatch below is therefore
 * built so that nothing loads dotenv or `@novastar/database` until a command
 * that actually needs a database has been named. Command modules are reached
 * through a dynamic import for the same reason.
 *
 * See README.md for the authorisation model. Possession of `DATABASE_URL` is
 * authorisation; this tool has no authentication of its own and deletes nothing.
 */
import { out } from "./output";

interface CommandSpec {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  /**
   * The command module, loaded only when this command is actually dispatched.
   * A dynamic import is what keeps `--help` free of dotenv and the database.
   */
  readonly load: () => Promise<Record<string, unknown>>;
  /** The exported entry point inside that module. */
  readonly entry: string;
}

type ArgMap = import("./commands/shared").ArgMap;
type CommandRunner = (args: ArgMap) => Promise<void>;

const COMMANDS: readonly CommandSpec[] = [
  {
    name: "create",
    summary: "Provision a tenant, its first school and an optional administrator",
    usage: "novastar-tenant create --code <code> --name <name> --school-name <name> [...]",
    load: () => import("./commands/create"),
    entry: "runCreate",
  },
  {
    name: "clone",
    summary: "Copy one tenant's configuration into another tenant",
    usage: "novastar-tenant clone --from <code> --to <code> [--apply]",
    load: () => import("./commands/clone"),
    entry: "runClone",
  },
  {
    name: "list",
    summary: "Every tenant with its school and user counts",
    usage: "novastar-tenant list [--json]",
    load: () => import("./commands/list"),
    entry: "runList",
  },
  {
    name: "show",
    summary: "One tenant in full: schools, branding, config entities, counts",
    usage: "novastar-tenant show [--tenant <code>] [--json]",
    load: () => import("./commands/show"),
    entry: "runShow",
  },
  {
    name: "set",
    summary: "Patch a mutable Tenant or School field",
    usage: "novastar-tenant set --tenant <code> --field <name> --value <value> [--school <code>]",
    load: () => import("./commands/set"),
    entry: "runSet",
  },
  {
    name: "config get",
    summary: "Read a tenant or school settings document",
    usage: "novastar-tenant config get [--tenant <code>] [--school <code>]",
    load: () => import("./commands/config/get"),
    entry: "runConfigGet",
  },
  {
    name: "config set",
    summary: "Write one dot-path into a settings document",
    usage: "novastar-tenant config set [--tenant <code>] --key <path> --value <json>",
    load: () => import("./commands/config/set"),
    entry: "runConfigSet",
  },
  {
    name: "config export",
    summary: "Write a versionable JSON document of clonable configuration",
    usage: "novastar-tenant config export --out <file> [--tenant <code>]",
    load: () => import("./commands/config/export"),
    entry: "runConfigExport",
  },
  {
    name: "import",
    summary: "Apply an exported configuration document (dry run by default)",
    usage: "novastar-tenant import --file <file> [--tenant <code>] [--apply]",
    load: () => import("./commands/import"),
    entry: "runImport",
  },
  {
    name: "suspend",
    summary: "Set a tenant's isActive to false. Never deletes",
    usage: "novastar-tenant suspend --tenant <code> [--yes]",
    load: () => import("./commands/suspend"),
    entry: "runSuspend",
  },
  {
    name: "reactivate",
    summary: "Set a tenant's isActive to true",
    usage: "novastar-tenant reactivate --tenant <code> [--yes]",
    load: () => import("./commands/reactivate"),
    entry: "runReactivate",
  },
{
    name: "user",
    summary: "Create a tenant administrator or rotate a password",
    usage: "novastar-tenant user --tenant <code> --email <email> [--rotate]",
    load: () => import("./commands/user"),
    entry: "runUser",
  },
  {
    name: "operator",
    summary: "Create or reset a platform operator for the super-admin console",
    usage: "novastar-tenant operator --username <name> --email <email> --capabilities <list> [--rotate]",
    load: () => import("./commands/operator"),
    entry: "runOperator",
  },
];

function renderHelp(): string {
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  const lines = [
    "novastar-tenant -- tenant provisioning, cloning and configuration",
    "",
    `Usage: novastar-tenant <command> [options]`,
    "",
    "Commands:",
    ...COMMANDS.map(
      (command) => `  ${command.name.padEnd(width)}  ${command.summary}`,
    ),
    "",
"Global options:",
    "  --help, -h     print this text and exit 0",
    "  --json         machine-readable output, where a command supports it",
    "",
"Environment:",
    "  DATABASE_URL                    required by every command except --help",
    "  TENANT_CODE                     default tenant for show, set, config and suspend",
    "  TENANT_ADMIN_PASSWORD           initial administrator password; never defaulted",
    "  PLATFORM_OPERATOR_PASSWORD      operator password for `operator`; never defaulted",
    "",
    "Run `novastar-tenant <command> --help` for a command's own options.",
    "",
    "Authorisation: possession of DATABASE_URL is authorisation. This tool",
    "deletes nothing, never prints a credential, and never invents a default",
    "password. See README.md.",
  ];
  return lines.join("\n");
}

function renderCommandHelp(spec: CommandSpec): string {
  return [
    spec.summary,
    "",
    spec.usage,
    "",
    "Run the command to see the full option list in its own error messages, or",
    "read README.md.",
  ].join("\n");
}

function findCommand(words: readonly string[]): CommandSpec | undefined {
  const single = COMMANDS.find((command) => !command.name.includes(" ") && command.name === words[0]);
  if (single) return single;
  return COMMANDS.find((command) => command.name === `${words[0]} ${words[1] ?? ""}`.trim());
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    out.line(renderHelp());
    return 0;
  }

  const spec = findCommand(argv);
  if (!spec) {
    out.failure(`Unknown command "${argv[0]}".`);
    out.line(renderHelp());
    return 2;
  }

  const rest = argv.slice(spec.name.split(" ").length);
  if (rest.includes("--help") || rest.includes("-h")) {
    out.line(renderCommandHelp(spec));
    return 0;
  }

const { ArgMap, UsageError } = await import("./commands/shared");
  try {
    const commandModule = await spec.load();
    const run = commandModule[spec.entry] as CommandRunner;
    if (typeof run !== "function") {
      throw new Error(`Internal error: ${spec.name} does not export ${spec.entry}.`);
    }
    await run(ArgMap.parse(rest));
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      out.failure(error.message);
      return 2;
    }
    out.failure(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// Only dispatch when this file is the process entry point. Without the guard,
// `import ... from '@novastar/tenant-cli'` would run the CLI -- and potentially
// call `process.exit()` -- as a side effect of module initialisation. The
// provisioning API is re-exported below precisely so consumers can import the
// package root safely.
export { provisionTenant, type ProvisionInput, type ProvisionedTenant } from "./provision";

if (import.meta.main) {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
}
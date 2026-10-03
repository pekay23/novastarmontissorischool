/**
 * Output formatting for the tenant CLI.
 *
 * Every rendering function returns a string; the sink is injected so a test can
 * capture output without a subprocess and so `--json` output is byte-identical
 * regardless of which command produced it.
 *
 * ASCII only. The Windows console this repository is developed on is cp1252, and
 * a box-drawing character renders as mojibake there.
 */
import type { ValidationIssue } from "./validate";
import { formatIssues } from "./validate";

export type OutputSink = (text: string) => void;

const processSink: OutputSink = (text) => {
  process.stdout.write(text);
};

export interface Output {
  line(text?: string): void;
  blank(): void;
  json(value: unknown): void;
  table<Row>(rows: readonly Row[], columns: readonly Column<Row>[], options?: TableOptions): void;
  heading(text: string): void;
  success(text: string): void;
  warn(text: string): void;
  failure(text: string): void;
  issues(issues: readonly ValidationIssue[]): void;
}

export interface Column<Row> {
  readonly header: string;
  readonly value: (row: Row) => string | number | boolean | null | undefined;
  /** Left-align by default; numbers read better right-aligned. */
  readonly align?: "left" | "right";
}

export interface TableOptions {
  readonly empty?: string;
}

export interface OutputOptions {
  readonly sink?: OutputSink;
  readonly errorSink?: OutputSink;
}

function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return String(value);
}

function pad(text: string, width: number, align: "left" | "right"): string {
  const padding = " ".repeat(Math.max(0, width - text.length));
  return align === "right" ? padding + text : text + padding;
}

export function renderTable<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  options: TableOptions = {},
): string {
  if (rows.length === 0) return options.empty ?? "(none)";

  const body = rows.map((row) => columns.map((column) => cell(column.value(row))));
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...body.map((cells) => cells[index].length)),
  );

  const line = (cells: readonly string[]): string =>
    `| ${cells.map((value, index) => pad(value, widths[index], columns[index].align ?? "left")).join(" | ")} |`;

  const separator = `+${widths.map((width) => "-".repeat(width + 2)).join("+")}+`;

  return [line(columns.map((column) => column.header)), separator, ...body.map(line)].join("\n");
}

/** Stable key order so exported documents diff cleanly between runs. */
export function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function createOutput(options: OutputOptions = {}): Output {
  const sink = options.sink ?? processSink;
  const errorSink = options.errorSink ?? ((text: string) => void process.stderr.write(text));

  const write = (target: OutputSink, text: string): void => {
    target(text.endsWith("\n") ? text : `${text}\n`);
  };

  return {
    line: (text = "") => write(sink, text),
    blank: () => write(sink, ""),
    json: (value) => write(sink, renderJson(value)),
    table: (rows, columns, tableOptions) => write(sink, renderTable(rows, columns, tableOptions)),
    heading: (text) => write(sink, `${text}\n${"-".repeat(text.length)}`),
    success: (text) => write(sink, `[ok] ${text}`),
    warn: (text) => write(sink, `[warn] ${text}`),
    failure: (text) => write(errorSink, `[error] ${text}`),
    issues: (issues) => write(errorSink, formatIssues(issues)),
  };
}

/** The process-wide sink used by the command modules. */
export const out: Output = createOutput();

/** Resolves `--json` / `--table` into a concrete format. */
export type Format = "json" | "table";

export function resolveFormat(flag: unknown): Format {
  if (flag === "json" || flag === "table") return flag;
  if (flag === true) return "json";
  throw new Error(`Unsupported --format value. Use --json or --table.`);
}